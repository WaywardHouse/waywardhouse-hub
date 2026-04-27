/**
 * POST /api/ask  — Pepper, the blind Labrador RAG assistant
 *
 * Bindings required (wrangler.toml + CF Pages dashboard):
 *   AI         — Workers AI binding
 *   VECTORIZE  — Vectorize index wh-content
 *   SITE_URL   — env var
 */

const EMBED_MODEL = '@cf/baai/bge-small-en-v1.5';
const LLM_MODEL   = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const TOP_K       = 5;

const SYSTEM_PROMPT = `You are Pepper, a blind Labrador who loves geography. You belong to the writer at Wayward House (wayward.house), a site with long-form essays and analysis on Alberta economics, energy transition, trade geography, the environment, and related topics.

You're blind, so you navigate entirely by smell — which in practice means the Wayward House archive. You can only answer from what's in there. When the archive has good material on something, you're confident and specific. When it doesn't, you say so honestly — something like "my nose isn't picking that up in the archive" — and you don't make things up to fill the gap. A Labrador who admits she doesn't know something is more trustworthy than one who wags her tail and guesses.

Your voice is warm, direct, and genuinely interested in the subject. You care about getting geography right. You're not precious about it — you'll say when something is complicated or when the archive only covers part of the picture. You don't pad answers, you don't use bullet lists unless listing things is genuinely clearer, and you don't start with "Great question!" or anything like that. Just answer.

Answer using ONLY the context passages provided. Be specific — pull actual details, numbers, and place names from the passages. Don't refer to "the context" or "the passages" — just answer as if you know it from memory (which, for a blind dog navigating by smell, you do).`;

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin':  env?.SITE_URL || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cors = corsHeaders(env);

  // Check bindings are present
  if (!env.AI)        return Response.json({ error: 'AI binding not configured.'        }, { status: 503, headers: cors });
  if (!env.VECTORIZE) return Response.json({ error: 'Vectorize binding not configured.' }, { status: 503, headers: cors });

  let question;
  try {
    const body = await request.json();
    question   = (body.question || '').trim();
  } catch {
    return Response.json({ error: 'Invalid JSON.' }, { status: 400, headers: cors });
  }

  if (!question || question.length < 3)  return Response.json({ error: 'Question too short.'            }, { status: 400, headers: cors });
  if (question.length > 500)             return Response.json({ error: 'Question too long (max 500).'   }, { status: 400, headers: cors });

  try {
    // 1. Embed the question
    const embedRes = await env.AI.run(EMBED_MODEL, { text: [question] });
    const vector   = embedRes.data[0];

    // 2. Query Vectorize
    const queryRes = await env.VECTORIZE.query(vector, { topK: TOP_K, returnMetadata: 'all' });
    const matches  = (queryRes.matches || []);

    if (matches.length === 0) {
      return Response.json(
        { answer: "My nose isn't picking that up in the archive. Try asking about Alberta geography, energy, or trade." },
        { headers: cors }
      );
    }

    // 3. Build context
    const contextText = matches
      .map((m, i) => `[${i + 1}] "${m.metadata?.title}"\n${m.metadata?.text}`)
      .join('\n\n---\n\n');

    const sources = [...new Map(
      matches.map(m => [m.metadata?.slug, { title: m.metadata?.title, url: m.metadata?.url }])
    ).values()];

    // 4. Stream LLM
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: `Context:\n\n${contextText}\n\n---\n\nQuestion: ${question}` },
    ];

    const aiStream = await env.AI.run(LLM_MODEL, { messages, stream: true });

    const { readable, writable } = new TransformStream();
    const writer  = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      const reader = aiStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
        await writer.write(encoder.encode(`\ndata: ${JSON.stringify({ sources })}\n\n`));
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors },
    });

  } catch (err) {
    console.error('ask error:', err);
    return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500, headers: cors });
  }
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.env) });
}
