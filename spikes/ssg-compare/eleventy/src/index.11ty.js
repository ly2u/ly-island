import { escape } from './_includes/html.js';
import { island } from './_includes/island.js';
import { notesFrom } from './_includes/notes.js';
import { islandShape } from '../../shared/island-data.mjs';

export const data = { layout: 'base.11ty.js', title: '示例岛' };

export function render({ collections }) {
  const notes = notesFrom(collections.notes);
  const items = notes
    .map((note) => {
      const iso = note.date.toISOString();
      return `<li><a href="/notes/${note.slug}/">${escape(note.title)}</a> <time datetime="${iso}">${iso.slice(0, 10)}</time></li>`;
    })
    .join('\n');
  return `${island(islandShape(notes))}\n<ul>\n${items}\n</ul>`;
}
