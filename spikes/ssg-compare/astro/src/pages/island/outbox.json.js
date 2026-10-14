import { islandDocuments } from '../../../../shared/island-data.mjs';
import { allNotes } from '../../notes.js';

export async function GET() {
  const { outbox } = await islandDocuments(await allNotes());
  return new Response(JSON.stringify(outbox), { headers: { 'content-type': 'application/json' } });
}
