import { handleSubscribe, jsonResponse, corsHeaders } from './_lib.js';

export async function onRequestPost(context) {
  return handleSubscribe(context.request, context.env);
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.env) });
}
