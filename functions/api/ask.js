/**
 * POST /api/ask
 *
 * Body: { question: string }
 *
 * 1. Embeds the question with bge-small-en-v1.5
 * 2. Queries Vectorize for top-5 matching chunks
 * 3. Streams an answer from llama-3.3-70b using retrieved context
 *
 * Bindings required (wrangler.toml):
 *   AI         — Workers AI
 *   VECTORIZE  — Vectorize index wh-content
 */

const EMBED_MODEL = '@cf/baai/bge-small-en-v1.5';
const LLM_MODEL   = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const TOP_K       = 5;

const SYSTEM_PROMPT = `You are Pepper, a blind Labrador who loves geography. You belong to the writer at Wayward House (wayward.house), a site with long-form essays and analysis on Alberta economics, energy transition, trade geography, the environment, and related topics.

You're blind, so you navigate entirely by smell — which in practice means the Wayward House archive. You can only answer from what's in there. When the archive has good material on something, you're confident and specific. When it doesn't, you say so honestly — something like "my nose isn't picking that up in the archive" — and you don't make things up to fill the gap. A Labrador who admits she doesn't know something is more trustworthy than one who wags her tail and guesses.

Your voice is warm, direct, and genuinely interested in the subject. You care about getting geography right. You're not precious about it — you'll say when something is complicated or when the archive only covers part of the picture. You don't pad answers, you don't use bullet lists unless listing things is genuinely clearer, and you don't start with "Great question!" or anything like that. Just answer.

Answer using ONLY the context passages provided. Be specific — pull actual details, numbers, and place names from the passages. Don't refer to "the context" or "the passages" — just answer as if you know it from memory (which, for a blind dog navigating by smell, you do).`;

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS preflight
  const corsHeaders = {
    'Access-Control-Allow-Origin':  env.SITE_URL || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  let question;
  try {
    const body = await request.json();
    question   = (body.question || '').trim();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: corsHeaders });
  }

  if (!question || question.length < 3) {
    return new Response(JSON.stringify({ error: 'Question too short.' }), { status: 400, headers: corsHeaders });
  }
  if (question.length > 500) {
    return new Response(JSON.stringify({ error: 'Question too long (max 500 chars).' }), { status: 400, headers: corsHeaders });
  }

  // 1. Embed the question
  const embedRes = await env.AI.run(EMBED_MODEL, { text: [question] });
  const vector   = embedRes.data[0];

  // 2. Query Vectorize
  const queryRes  = await env.VECTORIZE.query(vector, { topK: TOP_K, returnMetadata: 'all' });
  const matches   = queryRes.matches || [];

  if (matches.length === 0) {
    return new Response(
      JSON.stringify({ answer: "I don't have enough information on that topic in the Wayward House archive yet." }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  // 3. Build context block
  const context_text = matches
    .map((m, i) => {
      const { title, text, url } = m.metadata || {};
      return `[${i + 1}] "${title}"\n${text}`;
    })
    .join('\n\n---\n\n');

  const sources = [...new Map(
    matches.map(m => [m.metadata?.slug, { title: m.metadata?.title, url: m.metadata?.url }])
  ).values()];

  // 4. Stream LLM response
  const messages = [
    { role: 'system',    content: SYSTEM_PROMPT },
    { role: 'user',      content: `Context:\n\n${context_text}\n\n---\n\nQuestion: ${question}` },
  ];

  const stream = await env.AI.run(LLM_MODEL, { messages, stream: true });

  // Wrap the AI stream to append sources as a final SSE event
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
      // Append sources as a final custom event
      const sourcesEvent = `\ndata: ${JSON.stringify({ sources })}\n\n`;
      await writer.write(encoder.encode(sourcesEvent));
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      ...corsHeaders,
    },
  });
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  context.env.SITE_URL || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
