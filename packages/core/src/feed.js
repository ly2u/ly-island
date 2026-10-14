// RSS 2.0 for readers that do not know the protocol: the summary in
// <description>, the full text in <content:encoded>, newest first.

import { excerpt, publicRecords } from './records.js';

export const FEED_ITEMS = 50;
const CONTENT_NS = 'http://purl.org/rss/1.0/modules/content/';
const ATOM_NS = 'http://www.w3.org/2005/Atom';

/** Escapes text for XML and drops characters XML 1.0 does not allow. @param {string} text */
export function escapeXml(text) {
  return String(text)
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Makes root-relative links and images absolute, for readers. @param {string} html @param {string} origin */
export function absoluteLinks(html, origin) {
  return html.replace(/\b(href|src)=(["'])\/(?!\/)/g, (_, attribute, quote) => `${attribute}=${quote}${origin}/`);
}

/** @param {string} time RFC 3339 */
const rfc822 = (time) => new Date(time).toUTCString();

/**
 * @param {{ config: import('./config.js').IslandConfig, records: import('./records.js').IslandRecord[] }} input
 */
export function buildFeed({ config, records }) {
  const { origin } = config;
  const items = publicRecords(records).slice(0, FEED_ITEMS);
  const newest = items.reduce((max, record) => {
    const time = record.updated ?? record.published;
    return time > max ? time : max;
  }, '');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<rss version="2.0" xmlns:content="${CONTENT_NS}" xmlns:atom="${ATOM_NS}">`,
    '<channel>',
    `<title>${escapeXml(config.name)}</title>`,
    `<link>${escapeXml(`${origin}/`)}</link>`,
    `<description>${escapeXml(config.summary ?? config.name)}</description>`,
    `<language>${escapeXml(config.language[0])}</language>`,
    `<atom:link href="${escapeXml(`${origin}/feed.xml`)}" rel="self" type="application/rss+xml"/>`,
    ...(newest ? [`<lastBuildDate>${rfc822(newest)}</lastBuildDate>`] : []),
  ];
  for (const record of items) {
    lines.push(
      '<item>',
      `<title>${escapeXml(record.displayTitle)}</title>`,
      `<link>${escapeXml(record.url)}</link>`,
      `<guid isPermaLink="true">${escapeXml(record.url)}</guid>`,
      `<pubDate>${rfc822(record.published)}</pubDate>`,
      `<description>${escapeXml(record.summary ?? excerpt(record.text, 200))}</description>`,
      ...(record.html ? [`<content:encoded>${escapeXml(absoluteLinks(record.html, origin))}</content:encoded>`] : []),
      ...record.tags.map((tag) => `<category>${escapeXml(tag)}</category>`),
      '</item>',
    );
  }
  lines.push('</channel>', '</rss>', '');
  return lines.join('\n');
}
