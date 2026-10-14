// Records as the island sees them: normalized from front matter, checked
// against the protocol limits, with every problem reported at once.

import { LIMITS } from '../../protocol/src/index.js';
import { dateTime, localDate } from './dates.js';

export const RECORD_KINDS = Object.freeze(['article', 'note', 'project']);
/** File names become URLs, so they are kept to lowercase ASCII words joined by "-". */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXCERPT_LENGTH = 80;

/**
 * @typedef {object} RecordInput what the site passes in, one per Markdown file
 * @property {string} slug
 * @property {string} [title]
 * @property {string} kind
 * @property {Date | string} date
 * @property {Date | string} [updated]
 * @property {string} [summary]
 * @property {string[]} [tags]
 * @property {string} [language]
 * @property {Date | string} [done] when a project was finished
 * @property {Date | string} [withdrawn] when the record was withdrawn; the file stays
 * @property {boolean} [draft]
 * @property {string} [html] rendered body
 *
 * @typedef {object} IslandRecord
 * @property {string} slug
 * @property {string} path site path, e.g. "/records/first-bridge/"
 * @property {string} url absolute URL
 * @property {string} [title]
 * @property {string} displayTitle title, or the start of the text for untitled notes
 * @property {string} kind
 * @property {string} date local date, YYYY-MM-DD
 * @property {string} published RFC 3339
 * @property {string} [updated] RFC 3339
 * @property {string} [summary]
 * @property {string[]} tags
 * @property {string} language
 * @property {string} [done] YYYY-MM-DD
 * @property {string} [withdrawn] YYYY-MM-DD
 * @property {string} html
 * @property {string} text plain text of the body
 */

export class RecordError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`records have problems:\n- ${problems.join('\n- ')}`);
    this.problems = problems;
  }
}

/** Plain text from rendered HTML, for excerpts and checks. @param {string} html */
export function plainText(html) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {string} text @param {number} length */
export function excerpt(text, length = EXCERPT_LENGTH) {
  const chars = Array.from(text);
  return chars.length <= length ? text : `${chars.slice(0, length).join('').trimEnd()}…`;
}

/** @param {unknown} value @param {number} max */
const textOk = (value, max) => typeof value === 'string' && value.trim() !== '' && Array.from(value).length <= max;

/**
 * Normalizes and checks all records. Drafts are dropped. Throws RecordError
 * listing every problem.
 * @param {RecordInput[]} inputs
 * @param {{ origin: string, timeZone: string, language: string }} options
 * @returns {IslandRecord[]} newest first
 */
export function normalizeRecords(inputs, { origin, timeZone, language }) {
  /** @type {string[]} */
  const problems = [];
  /** @type {IslandRecord[]} */
  const records = [];
  const seen = new Set();

  for (const input of inputs) {
    if (input.draft === true) continue;
    const where = input.slug;
    const issue = (/** @type {string} */ message) => problems.push(`${where}: ${message}`);

    if (!SLUG.test(input.slug)) issue('the file name must use lowercase letters, digits and "-", e.g. first-bridge.md');
    if (seen.has(input.slug)) issue('another record has the same file name');
    seen.add(input.slug);
    if (!RECORD_KINDS.includes(input.kind)) issue(`kind must be one of ${RECORD_KINDS.join(', ')}`);
    if (input.title !== undefined && !textOk(input.title, LIMITS.title)) issue(`title must be 1 to ${LIMITS.title} characters`);
    if (input.title === undefined && input.kind !== 'note') issue('only notes may leave out the title');
    if (input.summary !== undefined && !textOk(input.summary, LIMITS.summary)) issue(`summary must be 1 to ${LIMITS.summary} characters`);
    const tags = input.tags ?? [];
    if (!Array.isArray(tags) || tags.length > LIMITS.tags || !tags.every((tag) => textOk(tag, LIMITS.tagLength))) {
      issue(`tags must be at most ${LIMITS.tags} words of at most ${LIMITS.tagLength} characters`);
    }

    /** @param {Date | string | undefined} value @param {string} field */
    const day = (value, field) => {
      if (value === undefined) return undefined;
      try {
        return localDate(value, timeZone);
      } catch {
        issue(`${field} is not a date`);
        return undefined;
      }
    };
    const date = day(input.date, 'date');
    if (input.date === undefined) issue('date is required');
    const done = day(input.done, 'done');
    const withdrawn = day(input.withdrawn, 'withdrawn');
    if (done !== undefined && input.kind !== 'project') issue('only projects can be done');
    if (date && done && done < date) issue('done cannot be before date');
    if (date && withdrawn && withdrawn < date) issue('withdrawn cannot be before date');
    let updated;
    if (input.updated !== undefined) {
      try {
        updated = dateTime(input.updated);
      } catch {
        issue('updated is not a date');
      }
    }
    if (!date || input.date === undefined) continue;
    const published = dateTime(input.date);
    if (updated && updated < published) issue('updated cannot be before date');

    const html = input.html ?? '';
    const text = plainText(html);
    const path = `/records/${input.slug}/`;
    records.push({
      slug: input.slug,
      path,
      url: `${origin}${path}`,
      ...(input.title !== undefined ? { title: input.title } : {}),
      displayTitle: input.title ?? (excerpt(input.summary ?? text, 40) || date),
      kind: input.kind,
      date,
      published,
      ...(updated && updated !== published ? { updated } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      tags: Array.isArray(tags) ? [...tags] : [],
      language: input.language ?? language,
      ...(done ? { done } : {}),
      ...(withdrawn ? { withdrawn } : {}),
      html,
      text,
    });
  }
  if (problems.length > 0) throw new RecordError(problems);
  return records.sort((a, b) => (a.published === b.published ? a.slug.localeCompare(b.slug) : a.published < b.published ? 1 : -1));
}

/** Records that are public now: not withdrawn. @param {IslandRecord[]} records */
export function publicRecords(records) {
  return records.filter((record) => record.withdrawn === undefined);
}
