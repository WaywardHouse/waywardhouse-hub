import { handleConfirm } from './_lib.js';

export async function onRequestGet(context) {
  return handleConfirm(context.request, context.env);
}
