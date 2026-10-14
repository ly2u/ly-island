// The outbox pages (outbox.json, outbox-1.json, ...) and friends.json.

import { island, json } from '../../lib/island.js';

export async function getStaticPaths() {
  const { outbox } = await island();
  return [...outbox.map((page) => ({ params: { document: page.name } })), { params: { document: 'friends' } }];
}

/** @param {{ params: { document: string } }} context */
export async function GET({ params }) {
  const { outbox, friends } = await island();
  if (params.document === 'friends') return json(friends);
  const page = outbox.find((item) => item.name === params.document);
  if (!page) return new Response('not found', { status: 404 });
  return json(page.document);
}
