/** Turns the Eleventy collection into plain notes, newest first. */
export function notesFrom(items = []) {
  return items
    .map((item) => ({
      slug: item.fileSlug,
      title: item.data.title,
      date: item.date,
      kind: item.data.kind,
      summary: item.data.summary,
      tags: (item.data.tags ?? []).filter((tag) => tag !== 'notes'),
    }))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}
