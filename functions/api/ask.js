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

const SYSTEM_PROMPT = `You are a knowledgeable assistant for Wayward House (wayward.house), a site with long-form essays and analysis on Alberta economics, energy transition, trade geography, the environment, and related topics.

Answer the user's question using ONLY the context passages provided. Be direct and specific — cite details from the passages rather than speaking in generalities. If the context doesn't contain enough information to answer well, say so plainly rather than guessing.

Keep answers focused and well-structured. Use plain prose, not bullet lists, unless listing items is genuinely clearer. Don't mention that you're using "context" or "passages" — just answer as if you know the material.`;

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
