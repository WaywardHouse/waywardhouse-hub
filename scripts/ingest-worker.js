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

/** Short deterministic ID ≤ 64 bytes: first 8 chars of type + slug hash + chunk index */
async function makeId(type, slug, chunkIdx) {
  const key    = `${type}:${slug}`;
  const buf    = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(key));
  const hex    = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
  const prefix = type.slice(0, 3);  // e.g. "cha", "ess", "sig"
  return `${prefix}_${hex}_${chunkIdx}`;  // max: 3 + 1 + 20 + 1 + 5 = 30 chars
}

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
    const url   = new URL(request.url);
    const dry   = url.searchParams.has('dry');
    const slugParam = url.searchParams.get('slug'); // e.g. ?slug=fire-country

    if (url.pathname === '/list') {
      const lines = content.map(({ type, slug }) => `${type}/${slug}`);
      return new Response(lines.join('\n') + '\n');
    }

    if (url.pathname !== '/ingest') {
      return new Response(
        'GET /list\nGET /ingest?slug=<slug>\nGET /ingest?slug=<slug>&dry=1\n'
      );
    }

    const items = slugParam
      ? content.filter(c => c.slug === slugParam)
      : content;

    if (items.length === 0) {
      return new Response(`No content found for slug: ${slugParam}\n`, { status: 404 });
    }

    const log     = [];
    let   total   = 0;
    let   pending = [];

    async function flush() {
      if (pending.length === 0 || dry) { pending = []; return; }
      await env.VECTORIZE.upsert(pending);
      pending = [];
    }

    for (const { type, slug, url: itemUrl, raw } of items) {
      const title  = extractTitle(raw) || slug;
      const body   = stripFrontMatter(raw);
      const chunks = chunkText(body);

      log.push(`${type}/${slug}: ${chunks.length} chunks`);
      if (dry) { total += chunks.length; continue; }

      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const batch  = chunks.slice(i, i + EMBED_BATCH);
        const result = await env.AI.run(EMBED_MODEL, { text: batch });

        for (let j = 0; j < batch.length; j++) {
          const id = await makeId(type, slug, i + j);
          pending.push({
            id,
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
