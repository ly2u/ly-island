import { island, json } from '../../lib/island.js';

export async function GET() {
  return json((await island()).manifest);
}
