import { escape } from './html.js';

export const data = { layout: 'base.11ty.js' };

export function render({ title, page, content }) {
  const iso = page.date.toISOString();
  return `<article>
    <h1>${escape(title)}</h1>
    <time datetime="${iso}">${iso.slice(0, 10)}</time>
    ${content}
  </article>`;
}
