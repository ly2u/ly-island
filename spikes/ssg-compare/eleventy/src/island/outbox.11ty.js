import { islandDocuments } from '../../../shared/island-data.mjs';
import { notesFrom } from '../_includes/notes.js';

export const data = { permalink: '/island/outbox.json', eleventyExcludeFromCollections: true };

export async function render({ collections }) {
  const { outbox } = await islandDocuments(notesFrom(collections.notes));
  return JSON.stringify(outbox);
}
