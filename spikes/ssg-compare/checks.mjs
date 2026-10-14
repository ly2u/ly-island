// Output checks for the comparison spike: what each generator must produce
// before its numbers count. Used by measure.mjs and by checks.test.mjs.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  trustOnFirstUse,
  validateFriends,
  validateManifest,
  validateOutbox,
  verifyActivity,
} from '../../packages/protocol/src/index.js';
import { SITE } from './shared/island-data.mjs';
import { attributeOf, childElements, parseXml, textOf } from './xml.mjs';

export const CONTENT = new URL('./content/', import.meta.url);
export const PROTOCOL_FILES = ['.well-known/island.json', 'island/outbox.json', 'island/friends.json'];

/**
 * @typedef {{ slug: string, title: string, kind: string, summary: string, date: Date }} ExpectedNote
 */

/**
 * The notes every build must contain, read from the shared Markdown files.
 * Only the simple `key: value` front matter lines used by the examples are read.
 * @param {URL | string} [dir]
 * @returns {ExpectedNote[]}
 */
export function expectedNotes(dir = CONTENT) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => {
      const text = readFileSync(new URL(name, dir), 'utf8');
      const head = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
      const field = (/** @type {string} */ key) => new RegExp(`^${key}: (.*)$`, 'm').exec(head)?.[1] ?? '';
      return {
        slug: name.slice(0, -3),
        title: field('title'),
        kind: field('kind'),
        summary: field('summary'),
        date: new Date(`${field('date')}T00:00:00Z`),
      };
    });
}

/** @param {unknown} value */
function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/**
 * Reads a protocol file. Missing, unparsable and non-object files are all problems;
 * only a parsed JSON object is returned.
 * @param {string} dist @param {string} path @param {string[]} problems
 * @returns {Record<string, any> | undefined}
 */
function protocolObject(dist, path, problems) {
  const full = join(dist, path);
  if (!existsSync(full)) {
    problems.push(`${path}: missing`);
    return undefined;
  }
  let value;
  try {
    value = JSON.parse(readFileSync(full, 'utf8'));
  } catch (error) {
    problems.push(`${path}: not JSON (${/** @type {Error} */ (error).message})`);
    return undefined;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    problems.push(`${path}: must be a JSON object, found ${describe(value)}`);
    return undefined;
  }
  return value;
}

/**
 * Checks the three protocol documents: shape, the expected posts, and every signature.
 * Signatures are only checked when both the manifest and the outbox are valid.
 * @param {string} dist @param {ExpectedNote[]} notes
 * @returns {Promise<string[]>}
 */
export async function checkProtocol(dist, notes) {
  /** @type {string[]} */
  const problems = [];
  const [manifestPath, outboxPath, friendsPath] = PROTOCOL_FILES;

  const manifest = protocolObject(dist, manifestPath, problems);
  let manifestValid = false;
  if (manifest) {
    const result = validateManifest(manifest, { fetchedOrigin: SITE });
    manifestValid = result.ok;
    if (!result.ok) problems.push(`${manifestPath}: ${JSON.stringify(result.issues)}`);
  }

  const outbox = protocolObject(dist, outboxPath, problems);
  let outboxValid = false;
  if (outbox) {
    const result = validateOutbox(outbox);
    outboxValid = result.valid;
    if (!result.valid) {
      const itemIssues = result.items.filter((item) => !item.ok);
      problems.push(`${outboxPath}: ${JSON.stringify({ issues: result.issues, items: itemIssues })}`);
    } else {
      const ids = outbox.items.map((/** @type {{ id: string }} */ item) => item.id).sort();
      const expected = notes.map((note) => `${SITE}/notes/${note.slug}/`).sort();
      if (JSON.stringify(ids) !== JSON.stringify(expected)) {
        problems.push(`${outboxPath}: expected posts ${expected.join(', ')}, found ${ids.join(', ')}`);
      }
    }
  }

  if (manifestValid && outboxValid && manifest && outbox) {
    const history = await trustOnFirstUse(manifest, { now: new Date().toISOString() });
    for (const item of outbox.items) {
      const verified = await verifyActivity(history, item, { source: 'origin', delivery: false });
      if (!verified.ok) problems.push(`${outboxPath}: ${item.id} does not verify (${verified.reason})`);
    }
  }

  const friends = protocolObject(dist, friendsPath, problems);
  if (friends) {
    const result = validateFriends(friends);
    if (!result.ok) problems.push(`${friendsPath}: ${JSON.stringify(result.issues)}`);
  }
  return problems;
}

/** Fields each feed item may have. Both feeds are summary-only, so full text is a problem. */
const ITEM_FIELDS = new Set(['title', 'link', 'guid', 'description', 'pubDate']);

/**
 * Checks an RSS 2.0 feed: strict XML with namespaces, then one summary-only item per note.
 * @param {Uint8Array | string} bytes @param {ExpectedNote[]} notes
 * @returns {string[]}
 */
export function checkFeed(bytes, notes) {
  let root;
  try {
    root = parseXml(bytes);
  } catch (error) {
    return [`feed.xml: not well-formed XML: ${/** @type {Error} */ (error).message}`];
  }
  /** @type {string[]} */
  const problems = [];
  if (root.namespace !== null || root.local !== 'rss' || attributeOf(root, 'version') !== '2.0') {
    return [`feed.xml: the root must be <rss version="2.0">, found <${root.name}>`];
  }
  const channels = childElements(root, 'channel');
  if (channels.length !== 1) return [`feed.xml: expected one <channel>, found ${channels.length}`];
  const channel = channels[0];

  /** @param {import('./xml.mjs').XmlElement} parent @param {string} name @param {string} where */
  const field = (parent, name, where) => {
    const found = childElements(parent, name);
    if (found.length !== 1) {
      problems.push(`feed.xml: ${where} needs exactly one <${name}>, found ${found.length}`);
      return null;
    }
    const text = textOf(found[0]);
    if (text === null) problems.push(`feed.xml: ${where} <${name}> must hold text only`);
    return text;
  };

  field(channel, 'title', 'the channel');
  field(channel, 'description', 'the channel');
  const home = field(channel, 'link', 'the channel');
  if (home !== null && home !== `${SITE}/`) problems.push(`feed.xml: channel link is ${home}, expected ${SITE}/`);

  const items = childElements(channel, 'item');
  if (items.length !== notes.length) problems.push(`feed.xml: expected ${notes.length} items, found ${items.length}`);
  const remaining = new Map(notes.map((note) => [`${SITE}/notes/${note.slug}/`, note]));
  items.forEach((item, index) => {
    const where = `item ${index + 1}`;
    for (const child of item.children) {
      if (typeof child === 'string') continue;
      if (child.namespace !== null || !ITEM_FIELDS.has(child.local)) {
        problems.push(`feed.xml: ${where} has <${child.name}>; both feeds must be summary-only with the same fields`);
      }
    }
    const link = field(item, 'link', where);
    const note = link === null ? undefined : remaining.get(link);
    if (link !== null && !note) {
      problems.push(`feed.xml: ${where} links to ${link}, which is not an expected note or is repeated`);
    }
    const guid = childElements(item, 'guid');
    if (guid.length > 1 || (guid.length === 1 && textOf(guid[0]) !== link)) {
      problems.push(`feed.xml: ${where} <guid> must be absent or equal to its link`);
    }
    const title = field(item, 'title', where);
    const description = field(item, 'description', where);
    const pubDate = field(item, 'pubDate', where);
    if (!note || link === null) return;
    remaining.delete(link);
    if (title !== null && title !== note.title) problems.push(`feed.xml: ${where} title is "${title}", expected "${note.title}"`);
    if (description !== null && description !== note.summary) {
      problems.push(`feed.xml: ${where} description must be the summary "${note.summary}"`);
    }
    if (pubDate !== null && Date.parse(pubDate) !== note.date.getTime()) {
      problems.push(`feed.xml: ${where} pubDate "${pubDate}" is not ${note.date.toISOString()}`);
    }
  });
  for (const link of remaining.keys()) {
    if (items.length === notes.length) problems.push(`feed.xml: no item links to ${link}`);
  }
  return problems;
}

/**
 * Checks that a build produced everything the comparison relies on.
 * @param {string} dist @param {ExpectedNote[]} [notes]
 * @returns {Promise<string[]>} problems; empty means the build passes
 */
export async function checkOutputs(dist, notes = expectedNotes()) {
  /** @type {string[]} */
  const problems = [];
  if (!existsSync(dist)) return [`${dist}: no build output`];
  const read = (/** @type {string} */ path) => {
    const full = join(dist, path);
    if (existsSync(full)) return readFileSync(full);
    problems.push(`${path}: missing`);
    return null;
  };

  problems.push(...(await checkProtocol(dist, notes)));

  const feed = read('feed.xml');
  if (feed !== null) problems.push(...checkFeed(feed, notes));

  for (const note of notes) {
    const page = read(`notes/${note.slug}/index.html`)?.toString('utf8');
    if (page === undefined) continue;
    if (!page.includes(note.title)) problems.push(`notes/${note.slug}: the title is missing`);
    if (note.slug === 'first-bridge' && !page.includes('<table')) problems.push(`notes/${note.slug}: the Markdown table did not render`);
  }
  const home = read('index.html')?.toString('utf8');
  if (home !== undefined && !home.includes('<svg')) problems.push('index.html: no island picture');
  return problems;
}
