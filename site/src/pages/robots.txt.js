import { island } from '../lib/island.js';

export async function GET() {
  return new Response((await island()).robots, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
