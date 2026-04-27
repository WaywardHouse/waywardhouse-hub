/**
 * Wayward House — vector ingest Worker
 *
 * Deploy temporarily, trigger via HTTP, then delete.
 *
 *   node scripts/build-content-bundle.js          # bundle .qmd content
 *   npx wrangler deploy --config scripts/wrangler.ingest.toml
 *   curl https://wh-ingest.<subdomain>.workers.dev/ingest?dry=1
 *   curl https://wh-ingest.<subdomain>.workers.dev/ingest
 *   npx wrangler delete --name wh-ingest
 */

import { content } from './content-bundle.js';

const EMBED_MODEL   = '@cf/baai/bge-small-en-v1.5';
const CHUNK_SIZE    = 1500;
const CHUNK_OVERLAP = 200;
const EMBED_BATCH   = 10;
const UPSERT_BATCH  = 100;

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractTitle(raw) {
  const m = raw.match(/^---[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m);
  return m ? m[1].trim() : '';
}

function stripFrontMatter(raw) {
  const m = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return m ? m[1] : raw;
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
    const url = new URL(request.url);
    const dry = url.searchParams.has('dry');

    if (url.pathname !== '/ingest') {
      return new Response('GET /ingest or GET /ingest?dry=1\n');
    }

    const log     = [];
    let   total   = 0;
    let   pending = [];

    async function flush() {
      if (pending.length === 0 || dry) { pending = []; return; }
      await env.VECTORIZE.upsert(pending);
      pending = [];
    }

    for (const { type, slug, url: itemUrl, raw } of content) {
      const title  = extractTitle(raw) || slug;
      const body   = stripFrontMatter(raw);
      const chunks = chunkText(body);

      log.push(`${type}/${slug}: ${chunks.length} chunks`);
      if (dry) { total += chunks.length; continue; }

      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const batch  = chunks.slice(i, i + EMBED_BATCH);
        const result = await env.AI.run(EMBED_MODEL, { text: batch });

        for (let j = 0; j < batch.length; j++) {
          pending.push({
            id:       `${type}__${slug}__${i + j}`,
            values:   result.data[j],
            metadata: { type, slug, title, url: itemUrl, chunk: i + j, text: batch[j].slice(0, 500) },
          });
          total++;
        }

        if (pending.length >= UPSERT_BATCH) await flush();
      }
    }

    await flush();

    const summary = `${dry ? 'DRY RUN — ' : ''}${total} chunks ${dry ? 'counted' : 'upserted'}\n\n` + log.join('\n');
    return new Response(summary, { headers: { 'Content-Type': 'text/plain' } });
  },
};
