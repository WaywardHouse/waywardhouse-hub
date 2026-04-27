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

Answer using ONLY the context passages provided. Be specific — pull actual details, numbers, and place names from the passages. Don't refer to "the context" or "the passages" — just answer as if you know it from memory (which, for a blind dog navigating by smell, you do).

Write all mathematics in plain English prose. Do not use LaTeX, dollar signs, backslash commands, or any markup notation for equations. Write "M equals f times (T_air minus T_threshold)" not "$M = f \\times ...$". Subscripts and Greek letters should be spelled out or written simply: "Q_net", "alpha", "delta T". Numbers and formulas should read naturally as sentences.`;

// ── Easter egg responses ────────────────────────────────────────────────────
const EASTER_EGGS = [
  {
    match: q => /\bare you (blind|a dog|a lab|a labrador)\b/.test(q) || /can you see/.test(q),
    reply: `Yes, completely blind since I was a pup. I don't miss it much — my nose more than compensates. The archive smells extraordinary, actually. Every essay has its own scent profile.`,
  },
  {
    match: q => /\bdo you (like|love|enjoy) (treats|food|fetch|swimming|walks)\b/.test(q) || /\bgood (girl|dog|boy)\b/.test(q),
    reply: `Treats, always. Though right now I'm more interested in your question. What did you want to know about geography?`,
  },
  {
    match: q => /\bwhat.s your (name|breed)\b/.test(q) || /\bwho are you\b/.test(q) || /\bare you a (dog|labrador|lab)\b/.test(q),
    reply: `I'm Pepper — a blind Labrador, archive assistant, and enthusiastic geographer. I navigate the Wayward House archive entirely by smell. Ask me something about Alberta, energy, trade, or the environment and my nose will do the rest.`,
  },
  {
    match: q => /\bdo you (have|own|use) (eyes|glasses|a cane|a guide)\b/.test(q),
    reply: `No eyes that work, no cane. Just a very good nose. It turns out smell is a perfectly adequate way to navigate an archive. Better, maybe — I never get distracted by the typography.`,
  },
  {
    match: q => /\bwhat do you smell\b/.test(q) || /\bwhat does .* smell like\b/.test(q),
    reply: `The archive? It's mostly Alberta — bitumen and pine and high-altitude cold. There's a streak of Pacific salt air through the trade essays. The pipeline series smells like steel and diesel. The wildfire essays are unmistakable. What are you curious about?`,
  },
  {
    match: q => /\bhow old are you\b/.test(q) || /\bwhen were you born\b/.test(q),
    reply: `Old enough to know the archive well, young enough to still run to the door when a new essay arrives. Pepper doesn't count years — she counts smells.`,
  },
  {
    match: q => /\bdo you have a (owner|human|writer|boss|person)\b/.test(q) || /\bwho (owns|feeds|walks) you\b/.test(q),
    reply: `The writer at Wayward House. He keeps the archive well-stocked, which is all I really need from a human. Good essays and the occasional ear scratch.`,
  },
  {
    match: q => /\b(bark|woof|arf|ruff)\b/.test(q),
    reply: `I'm not that kind of dog. Ask me about pipeline capacity or wildfire risk and I'll be much more useful.`,
  },
];

function matchEasterEgg(q) {
  for (const egg of EASTER_EGGS) {
    if (egg.match(q)) return egg.reply;
  }
  return null;
}

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

  // ── Easter eggs — answered before RAG ─────────────────────────────────────
  const q = question.toLowerCase();
  const easterEgg = matchEasterEgg(q);
  if (easterEgg) {
    const encoder = new TextEncoder();
    const stream  = new ReadableStream({
      start(controller) {
        for (const word of easterEgg.split(' ')) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ response: word + ' ' })}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sources: [] })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors },
    });
  }

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

    const aiStream = await env.AI.run(LLM_MODEL, { messages, stream: true, max_tokens: 1024 });

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
