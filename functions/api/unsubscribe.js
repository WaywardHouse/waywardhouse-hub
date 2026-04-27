import { handleUnsubscribe } from './_lib.js';

export async function onRequestGet(context) {
  return handleUnsubscribe(context.request, context.env);
}
