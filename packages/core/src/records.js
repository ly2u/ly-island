// Records as the island sees them: normalized from front matter, checked
// against the protocol limits, with every problem reported at once.

import { LIMITS } from '../../protocol/src/index.js';
import { dateTime, isCalendarDate, localDate } from './dates.js';

export const RECORD_KINDS = Object.freeze(['article', 'note', 'project']);
/** File names become URLs, so they are kept to lowercase ASCII words joined by "-". */
// The explicit end assertion states that nothing, not even a newline, may follow
// (JavaScript's "$" already behaves so without the m flag; Python's does not).
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/;
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
 * @property {string} [doneAt] RFC 3339, retaining the completion instant
 * @property {string} [withdrawn] YYYY-MM-DD
 * @property {string} [withdrawnAt] RFC 3339, retaining the withdrawal instant
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

/** @param {string} a @param {string} b */
const later = (a, b) => (a > b ? a : b);

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
    const updatedDay = day(input.updated, 'updated');
    if (done !== undefined && input.kind !== 'project') issue('only projects can be done');
    if (!date || input.date === undefined) continue;

    // A date without a time means that whole local day: compare days when
    // either side has no time, and instants only when both have one.
    const published = dateTime(input.date, timeZone);
    const dateOnly = (/** @type {unknown} */ value) => typeof value === 'string' && isCalendarDate(value);
    /** @param {Date | string} value @param {string} local */
    const before = (value, local) => (dateOnly(value) || dateOnly(input.date) ? local < date : dateTime(value, timeZone) < published);
    if (done !== undefined && input.done !== undefined && before(input.done, done)) issue('done cannot be before date');
    if (withdrawn !== undefined && input.withdrawn !== undefined && before(input.withdrawn, withdrawn)) issue('withdrawn cannot be before date');
    // Within the same day, a date without a time is not before the record itself.
    const doneAt = done !== undefined && input.done !== undefined ? later(dateTime(input.done, timeZone), published) : undefined;
    const withdrawnAt = withdrawn !== undefined && input.withdrawn !== undefined ? later(dateTime(input.withdrawn, timeZone), published) : undefined;
    let updated;
    if (updatedDay !== undefined && input.updated !== undefined) {
      updated = dateTime(input.updated, timeZone);
      if (before(input.updated, updatedDay)) issue('updated cannot be before date');
      else if (updated <= published) {
        // Receivers only replace a post with a later version; say so instead of dropping it.
        issue('updated must be later than date; on the same day, write a time with an offset, e.g. 2026-10-05T21:00:00+08:00');
      }
    }

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
      ...(updated && updated > published ? { updated } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      tags: Array.isArray(tags) ? [...tags] : [],
      language: input.language ?? language,
      ...(done ? { done, doneAt } : {}),
      ...(withdrawn ? { withdrawn, withdrawnAt } : {}),
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
