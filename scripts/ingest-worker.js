/**
 * Wayward House — vector ingest Worker
 *
 * Runs locally via wrangler dev; uses native AI + Vectorize bindings.
 *
 * Usage:
 *   npx wrangler dev scripts/ingest-worker.js --config scripts/wrangler.ingest.toml
 *
 * Then in another terminal:
 *   curl http://localhost:8787/ingest          # ingest all content
 *   curl http://localhost:8787/ingest?dry=1    # dry run (counts only)
 *   curl http://localhost:8787/clear           # delete all vectors first (re-index)
 *
 * Content is read from the sibling repos at build time and bundled by wrangler.
 * See wrangler.ingest.toml for the text_blobs bindings.
 */

const EMBED_MODEL  = '@cf/baai/bge-small-en-v1.5';
const CHUNK_SIZE   = 1500;   // chars (~375 tokens)
const CHUNK_OVERLAP = 200;   // chars overlap between chunks
const EMBED_BATCH  = 10;     // texts per AI.run call
const UPSERT_BATCH = 100;    // vectors per VECTORIZE.upsert call

// ── Content registry ──────────────────────────────────────────────────────────
// Each entry matches a text_blob binding in wrangler.ingest.toml.
// binding:  env key for the raw file content
// type:     'essay' | 'signal'
// slug:     URL slug
// title:    display title (also in front matter but parsed below)

import essayManifest from './essay-manifest.json' assert { type: 'json' };
import signalManifest from './signal-manifest.json' assert { type: 'json' };

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripFrontMatter(raw) {
  const m = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return m ? m[1] : raw;
}

function extractTitle(raw) {
  const m = raw.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m);
  return m ? m[1].trim() : '';
}

function chunkText(text) {
  const clean = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const paragraphs = clean.split(/\n\n+/);
  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length > CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim());
      current = current.slice(-CHUNK_OVERLAP) + '\n\n' + para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 60);
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url     = new URL(request.url);
    const dry     = url.searchParams.has('dry');

    if (url.pathname === '/clear') {
      // List and delete all vectors (useful before re-indexing)
      return new Response('Use the CF dashboard to delete the index and recreate it for a full re-index.\n', { status: 200 });
    }

    if (url.pathname !== '/ingest') {
      return new Response('GET /ingest or GET /ingest?dry=1\n', { status: 200 });
    }

    const log     = [];
    let   total   = 0;
    let   pending = [];   // { id, values, metadata }

    async function flush() {
      if (pending.length === 0 || dry) { pending = []; return; }
      await env.VECTORIZE.upsert(pending);
      pending = [];
    }

    // Process one file
    async function processFile(raw, type, slug, urlPath) {
      const title  = extractTitle(raw) || slug;
      const body   = stripFrontMatter(raw);
      const chunks = chunkText(body);

      log.push(`${type}/${slug}: ${chunks.length} chunks`);

      if (dry) { total += chunks.length; return; }

      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const batch  = chunks.slice(i, i + EMBED_BATCH);
        const result = await env.AI.run(EMBED_MODEL, { text: batch });
        const vecs   = result.data;

        for (let j = 0; j < batch.length; j++) {
          pending.push({
            id:       `${type}__${slug}__${i + j}`,
            values:   vecs[j],
            metadata: {
              type,
              slug,
              title,
              url:   urlPath,
              chunk: i + j,
              text:  batch[j].slice(0, 500),
            },
          });
          total++;
        }

        if (pending.length >= UPSERT_BATCH) await flush();
      }
    }

    // Essays
    for (const { slug, binding } of essayManifest) {
      const raw = env[binding];
      if (!raw) { log.push(`MISSING binding: ${binding}`); continue; }
      await processFile(raw, 'essay', slug, `https://wayward.house/essays/${slug}`);
    }

    // Signals
    for (const { slug, binding } of signalManifest) {
      const raw = env[binding];
      if (!raw) { log.push(`MISSING binding: ${binding}`); continue; }
      await processFile(raw, 'signal', slug, `https://wayward.house/signals/${slug}`);
    }

    await flush();

    const summary = `${dry ? 'DRY RUN — ' : ''}${total} chunks ${dry ? 'counted' : 'upserted'}\n\n` + log.join('\n');
    return new Response(summary, { headers: { 'Content-Type': 'text/plain' } });
  },
};
