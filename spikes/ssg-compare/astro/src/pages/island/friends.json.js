import { islandDocuments } from '../../../../shared/island-data.mjs';
import { allNotes } from '../../notes.js';

export async function GET() {
  const { friends } = await islandDocuments(await allNotes());
  return new Response(JSON.stringify(friends), { headers: { 'content-type': 'application/json' } });
}
