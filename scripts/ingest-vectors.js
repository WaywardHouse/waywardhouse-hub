#!/usr/bin/env node
/**
 * Wayward House — vector ingest script (incremental)
 *
 * Reads all essays and signals, chunks them, generates embeddings via
 * Cloudflare Workers AI, and upserts to Vectorize.
 *
 * On each run the script hashes every source file and compares against a local
 * manifest (.ingest-manifest.json). Only new or changed files are processed;
 * unchanged files are skipped entirely.
 *
 * Usage:
 *   node scripts/ingest-vectors.js            # incremental (default)
 *   node scripts/ingest-vectors.js --dry-run  # show what would change, write nothing
 *   node scripts/ingest-vectors.js --force    # ignore manifest, re-ingest everything
 *   node scripts/ingest-vectors.js --prune    # also delete vectors for removed files
 *   node scripts/ingest-vectors.js --stats    # print manifest summary and exit
 *
 * Requires wrangler to be authenticated:
 *   npx wrangler login
 *
 * Set these before running:
 *   export CLOUDFLARE_API_TOKEN=your_token
 *   export CLOUDFLARE_ACCOUNT_ID=your_account_id
 *
 * The manifest is stored at scripts/.ingest-manifest.json — add it to .gitignore.
 * It is environment-specific and should not be committed.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';

// ── Flags ─────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');
const PRUNE   = process.argv.includes('--prune');
const STATS   = process.argv.includes('--stats');

// ── Config ────────────────────────────────────────────────────────────────────

const CHUNK_SIZE    = 400;   // target chars per chunk (≈ 100 tokens)
const CHUNK_OVERLAP = 80;    // overlap between consecutive chunks
const BATCH_SIZE    = 50;    // vectors per Vectorize upsert call
const EMBED_BATCH   = 10;    // texts per Workers AI embed call

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN  = process.env.CLOUDFLARE_API_TOKEN;

if (!STATS && (!ACCOUNT_ID || !API_TOKEN)) {
  console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN before running.');
  process.exit(1);
}

if (!STATS) {
  for (const [name, val] of [['CLOUDFLARE_API_TOKEN', API_TOKEN], ['CLOUDFLARE_ACCOUNT_ID', ACCOUNT_ID]]) {
    for (let i = 0; i < val.length; i++) {
      if (val.charCodeAt(i) > 127) {
        console.error(`${name} contains a non-ASCII character at position ${i} (U+${val.charCodeAt(i).toString(16).toUpperCase().padStart(4,'0')}). Re-paste from the Cloudflare dashboard.`);
        process.exit(1);
      }
    }
  }
}

const BASE_URL      = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;
const AI_URL        = `${BASE_URL}/ai/run/@cf/baai/bge-small-en-v1.5`;
const VECTORIZE_URL = `${BASE_URL}/vectorize/v2/indexes/wh-content/upsert`;
const DELETE_URL    = `${BASE_URL}/vectorize/v2/indexes/wh-content/delete-by-ids`;

// ── Content sources ───────────────────────────────────────────────────────────

const SOURCES = [
  {
    dir:   '../wh-essays/essays',
    type:  'essay',
    urlFn: (slug) => `https://wayward.house/essays/${slug}`,
    skip:  ['index.qmd'],
  },
  {
    dir:   '../wh-signals/signals',
    type:  'signal',
    urlFn: (slug) => `https://wayward.house/signals/${slug}`,
    skip:  ['index.qmd'],
  },
];

// ── Manifest ──────────────────────────────────────────────────────────────────
// Keyed by `${type}__${slug}`, e.g. "essay__building-for-hail".
// Saved after every successfully ingested file so a mid-run crash leaves the
// manifest consistent with what was actually written to Vectorize.

const MANIFEST_PATH = new URL('.ingest-manifest.json', import.meta.url).pathname;

function loadManifest() {
  if (existsSync(MANIFEST_PATH)) {
    try {
      return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    } catch {
      console.warn('Warning: manifest is corrupt, starting fresh.');
    }
  }
  return {};
}

function saveManifest(manifest) {
  if (!DRY_RUN) {
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  }
}

function manifestKey(type, slug) {
  return `${type}__${slug}`;
}

// ── Hashing ───────────────────────────────────────────────────────────────────

function hashContent(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// ── Front matter parser ───────────────────────────────────────────────────────

function parseFrontMatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)/);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body: match[2] };
}

// ── Chunker ───────────────────────────────────────────────────────────────────

function chunkText(text) {
  const clean = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[–—]/g, '-')
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x00-\xFF]/g, ' ')
    .trim();

  const paragraphs = clean.split(/\n\n+/);
  const chunks     = [];
  let   current    = '';

  for (const para of paragraphs) {
    if (current.length + para.length > CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim());
      current = current.slice(-CHUNK_OVERLAP) + '\n\n' + para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks.filter(c => c.length > 40);
}

// ── Workers AI embeddings ─────────────────────────────────────────────────────

async function embed(texts) {
  const res = await fetch(AI_URL, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text: texts }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI embed failed ${res.status}: ${body}`);
  }
  const { result } = await res.json();
  return result.data;
}

// ── Vectorize upsert ──────────────────────────────────────────────────────────

async function upsertBatch(vectors) {
  const ndjson = vectors.map(v => JSON.stringify(v)).join('\n');
  const res = await fetch(VECTORIZE_URL, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': 'application/x-ndjson' },
    body:    ndjson,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Vectorize upsert failed ${res.status}: ${body}`);
  }
  const { result } = await res.json();
  return result.mutationId;
}

// ── Vectorize delete ──────────────────────────────────────────────────────────
// Reconstructs vector IDs from the manifest's stored chunk count and deletes
// them before re-ingesting a changed file. This keeps the index clean — we
// can't just upsert because a rewrite may produce fewer chunks than before,
// leaving orphaned vectors with stale content.

async function deleteVectorsForSlug(type, slug, chunkCount) {
  if (chunkCount === 0) return;
  const ids = Array.from({ length: chunkCount }, (_, i) => `${type}__${slug}__${i}`);

  // Vectorize supports up to 5 000 IDs per delete call
  for (let i = 0; i < ids.length; i += 5000) {
    const batch = ids.slice(i, i + 5000);
    const res = await fetch(DELETE_URL, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ids: batch }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Vectorize delete failed ${res.status}: ${body}`);
    }
  }
}

// ── Ingest one file ───────────────────────────────────────────────────────────

async function ingestFile({ source, slug, raw, manifest }) {
  const { meta, body } = parseFrontMatter(raw);
  const chunks   = chunkText(body);
  const url      = source.urlFn(slug);
  const title    = meta.title || slug;
  const key      = manifestKey(source.type, slug);
  const existing = manifest[key];

  if (DRY_RUN) return { chunks: chunks.length };

  // Delete stale vectors first when updating a changed file so we don't
  // leave orphaned chunks if the new version produces fewer chunks.
  if (existing?.chunks) {
    await deleteVectorsForSlug(source.type, slug, existing.chunks);
  }

  // Embed in small batches then collect into allVecs
  const allVecs = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vecs  = await embed(batch);
    for (let j = 0; j < batch.length; j++) {
      allVecs.push({
        id:       `${source.type}__${slug}__${i + j}`,
        values:   vecs[j],
        metadata: {
          type:  source.type,
          slug,
          title,
          url,
          chunk: i + j,
          text:  batch[j].slice(0, 512),
        },
      });
    }
  }

  // Upsert in batches
  for (let i = 0; i < allVecs.length; i += BATCH_SIZE) {
    await upsertBatch(allVecs.slice(i, i + BATCH_SIZE));
  }

  return { chunks: chunks.length };
}

// ── --stats mode ──────────────────────────────────────────────────────────────

function printStats(manifest) {
  const entries = Object.entries(manifest);
  if (entries.length === 0) {
    console.log('Manifest is empty — nothing has been ingested yet.');
    return;
  }
  console.log(`\nManifest: ${MANIFEST_PATH}`);
  console.log(`Total tracked: ${entries.length} files\n`);

  const byType = {};
  for (const [key, val] of entries) {
    const type = key.split('__')[0];
    if (!byType[type]) byType[type] = [];
    byType[type].push({ key, ...val });
  }

  for (const [type, items] of Object.entries(byType)) {
    const totalChunks = items.reduce((s, i) => s + (i.chunks || 0), 0);
    console.log(`── ${type}s: ${items.length} files, ${totalChunks} total chunks`);
    for (const item of items.sort((a, b) => a.key.localeCompare(b.key))) {
      const ago = item.lastIngested
        ? Math.round((Date.now() - new Date(item.lastIngested)) / 86_400_000) + 'd ago'
        : 'unknown';
      const slug = item.key.replace(`${type}__`, '');
      console.log(`   ${slug.padEnd(40)} ${String(item.chunks).padStart(3)} chunks   ${ago}`);
    }
    console.log();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const baseDir  = new URL('..', import.meta.url).pathname;
  const manifest = loadManifest();

  if (STATS) {
    printStats(manifest);
    return;
  }

  const counters = { new: 0, updated: 0, unchanged: 0, pruned: 0, errors: 0 };
  const modeTag  = [DRY_RUN && 'dry-run', FORCE && 'force', PRUNE && 'prune'].filter(Boolean).join(', ');
  console.log(`\nWayward House vector ingest${modeTag ? ` (${modeTag})` : ''}`);

  // ── Process sources ───────────────────────────────────────────────────────

  for (const source of SOURCES) {
    const dir   = join(baseDir, source.dir);
    const files = readdirSync(dir).filter(f => f.endsWith('.qmd') && !source.skip.includes(f));

    console.log(`\n── ${source.type}s (${files.length} files) ──`);

    for (const file of files) {
      const slug     = basename(file, '.qmd');
      const raw      = readFileSync(join(dir, file), 'utf8');
      const hash     = hashContent(raw);
      const key      = manifestKey(source.type, slug);
      const existing = manifest[key];
      const isNew     = !existing;
      const isChanged = existing && existing.hash !== hash;

      // Skip unchanged files unless --force
      if (!FORCE && !isNew && !isChanged) {
        console.log(`  ${slug}: unchanged`);
        counters.unchanged++;
        continue;
      }

      const action   = isNew ? 'new' : `changed (was ${existing.chunks} chunks)`;
      process.stdout.write(`  ${slug}: ${action} — ingesting...`);

      try {
        const { chunks } = await ingestFile({ source, slug, raw, manifest });
        process.stdout.write(` ${chunks} chunks ✓\n`);

        if (!DRY_RUN) {
          manifest[key] = { hash, chunks, lastIngested: new Date().toISOString() };
          saveManifest(manifest); // write after each file — crash-safe
        }

        counters[isNew ? 'new' : 'updated']++;
      } catch (err) {
        process.stdout.write(` FAILED\n`);
        console.error(`    ${err.message}`);
        counters.errors++;
        // Manifest not updated — file will be retried on next run
      }
    }
  }

  // ── --prune: remove vectors for files deleted from disk ──────────────────

  if (PRUNE) {
    console.log('\n── pruning removed files ──');
    let pruneCount = 0;

    for (const [key, entry] of Object.entries(manifest)) {
      const [type, ...slugParts] = key.split('__');
      const slug   = slugParts.join('__');
      const source = SOURCES.find(s => s.type === type);
      if (!source) continue;

      const filePath = join(baseDir, source.dir, `${slug}.qmd`);
      if (!existsSync(filePath)) {
        process.stdout.write(`  ${key}: removed from disk — deleting ${entry.chunks} vectors...`);
        if (!DRY_RUN) {
          try {
            await deleteVectorsForSlug(type, slug, entry.chunks);
            delete manifest[key];
            saveManifest(manifest);
            process.stdout.write(' ✓\n');
            counters.pruned++;
          } catch (err) {
            process.stdout.write(' FAILED\n');
            console.error(`    ${err.message}`);
            counters.errors++;
          }
        } else {
          process.stdout.write(' (dry run)\n');
          counters.pruned++;
        }
        pruneCount++;
      }
    }

    if (pruneCount === 0) console.log('  nothing to prune');
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(48));
  console.log(`  new        ${counters.new}`);
  console.log(`  updated    ${counters.updated}`);
  console.log(`  unchanged  ${counters.unchanged}  (skipped)`);
  if (PRUNE)           console.log(`  pruned     ${counters.pruned}`);
  if (counters.errors) console.log(`  errors     ${counters.errors}  (will retry next run)`);
  if (DRY_RUN)         console.log('\n  Dry run — nothing written to Vectorize or manifest.');
}

main().catch(err => { console.error(err); process.exit(1); });
