import { island } from '../lib/island.js';

export async function GET() {
  return new Response((await island()).feed, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
}
