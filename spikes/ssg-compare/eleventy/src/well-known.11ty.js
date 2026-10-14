import { islandDocuments } from '../../shared/island-data.mjs';
import { notesFrom } from './_includes/notes.js';

export const data = { permalink: '/.well-known/island.json', eleventyExcludeFromCollections: true };

export async function render({ collections }) {
  const { manifest } = await islandDocuments(notesFrom(collections.notes));
  return JSON.stringify(manifest);
}
