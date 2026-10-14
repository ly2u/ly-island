import { getCollection } from 'astro:content';

/** All notes as plain objects, newest first. */
export async function allNotes() {
  const entries = await getCollection('notes');
  return entries
    .map((entry) => ({ slug: entry.id, ...entry.data }))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}
