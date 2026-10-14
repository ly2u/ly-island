import rss from '@astrojs/rss';
import { allNotes } from '../notes.js';
import { SITE_NAME, SITE_SUMMARY } from '../../../shared/island-data.mjs';

export async function GET(context) {
  const notes = await allNotes();
  return rss({
    title: SITE_NAME,
    description: SITE_SUMMARY,
    site: context.site,
    items: notes.map((note) => ({
      title: note.title,
      pubDate: note.date,
      description: note.summary,
      link: `/notes/${note.slug}/`,
    })),
  });
}
