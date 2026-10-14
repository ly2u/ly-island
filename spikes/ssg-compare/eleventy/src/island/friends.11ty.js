import { islandDocuments } from '../../../shared/island-data.mjs';
import { notesFrom } from '../_includes/notes.js';

export const data = { permalink: '/island/friends.json', eleventyExcludeFromCollections: true };

export async function render({ collections }) {
  const { friends } = await islandDocuments(notesFrom(collections.notes));
  return JSON.stringify(friends);
}
