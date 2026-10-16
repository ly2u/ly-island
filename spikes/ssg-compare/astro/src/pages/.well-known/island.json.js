import { islandDocuments } from '../../../../shared/island-data.mjs';
import { allNotes } from '../../notes.js';

export async function GET() {
  const { manifest } = await islandDocuments(await allNotes());
  return new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } });
}
