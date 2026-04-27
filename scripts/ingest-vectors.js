#!/usr/bin/env node
/**
 * Wayward House — vector ingest script
 *
 * Reads all essays and signals, chunks them, generates embeddings via
 * Cloudflare Workers AI, and upserts to Vectorize.
 *
 * Usage:
 *   node scripts/ingest-vectors.js [--dry-run]
 *
 * Requires wrangler to be authenticated:
 *   npx wrangler login
 *
 * The script calls the Workers AI REST API directly using the CLOUDFLARE_API_TOKEN
 * and CLOUDFLARE_ACCOUNT_ID env vars (or reads them from .dev.vars / wrangler config).
 *
 * Set these before running:
 *   export CLOUDFLARE_API_TOKEN=your_token
 *   export CLOUDFLARE_ACCOUNT_ID=your_account_id
 */

import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const DRY_RUN       = process.argv.includes('--dry-run');
const CHUNK_SIZE    = 400;   // target chars per chunk (≈ 100 tokens)
const CHUNK_OVERLAP = 80;    // overlap between chunks
const BATCH_SIZE    = 50;    // vectors per Vectorize upsert call
const EMBED_BATCH   = 10;    // texts per Workers AI embed call

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN  = process.env.CLOUDFLARE_API_TOKEN;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN before running.');
  process.exit(1);
}

const AI_URL        = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/baai/bge-small-en-v1.5`;
const VECTORIZE_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/wh-content/upsert`;

// ── Content sources ───────────────────────────────────────────────────────────

const SOURCES = [
  {
    dir:    '../wh-essays/essays',
    type:   'essay',
    urlFn:  (slug) => `https://wayward.house/essays/${slug}`,
    skip:   ['index.qmd'],
  },
  {
    dir:    '../wh-signals/signals',
    type:   'signal',
    urlFn:  (slug) => `https://wayward.house/signals/${slug}`,
    skip:   ['index.qmd'],
  },
];

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
  // Strip markdown syntax, code blocks, HTML comments
  const clean = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const paragraphs = clean.split(/\n\n+/);
  const chunks     = [];
  let   current    = '';

  for (const para of paragraphs) {
    if (current.length + para.length > CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim());
      // overlap: keep last CHUNK_OVERLAP chars
      current = current.slice(-CHUNK_OVERLAP) + '\n\n' + para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks.filter(c => c.length > 40); // drop tiny fragments
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
  return result.data; // array of float[] vectors
}

// ── Vectorize upsert ──────────────────────────────────────────────────────────

async function upsertBatch(vectors) {
  // Vectorize v2 upsert expects NDJSON
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const baseDir  = new URL('..', import.meta.url).pathname;
  let   allVecs  = [];
  let   total    = 0;

  for (const source of SOURCES) {
    const dir   = join(baseDir, source.dir);
    const files = readdirSync(dir).filter(f => f.endsWith('.qmd') && !source.skip.includes(f));

    console.log(`\n── ${source.type}s (${files.length} files) ──`);

    for (const file of files) {
      const slug    = basename(file, '.qmd');
      const raw     = readFileSync(join(dir, file), 'utf8');
      const { meta, body } = parseFrontMatter(raw);
      const chunks  = chunkText(body);
      const url     = source.urlFn(slug);
      const title   = meta.title || slug;

      console.log(`  ${slug}: ${chunks.length} chunks`);

      if (DRY_RUN) continue;

      // Embed in small batches
      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const batch  = chunks.slice(i, i + EMBED_BATCH);
        const vecs   = await embed(batch);

        for (let j = 0; j < batch.length; j++) {
          allVecs.push({
            id:       `${source.type}__${slug}__${i + j}`,
            values:   vecs[j],
            metadata: {
              type:    source.type,
              slug,
              title,
              url,
              chunk:   i + j,
              text:    batch[j].slice(0, 512), // store first 512 chars for retrieval
            },
          });
        }

        total += batch.length;
        process.stdout.write(`    embedded ${total} chunks so far\r`);
      }

      // Upsert when batch is big enough
      if (allVecs.length >= BATCH_SIZE) {
        await upsertBatch(allVecs.splice(0, BATCH_SIZE));
      }
    }
  }

  // Flush remainder
  if (!DRY_RUN && allVecs.length > 0) {
    await upsertBatch(allVecs);
  }

  console.log(`\n\nDone. ${total} chunks ${DRY_RUN ? '(dry run — nothing written)' : 'upserted to wh-content'}.`);
}

main().catch(err => { console.error(err); process.exit(1); });
