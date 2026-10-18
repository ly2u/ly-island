// Checks a built island (the dist folder) against what the framework
// promises: valid signed protocol documents, a strict feed, every record
// readable without JavaScript, the first-screen budget, no third-party
// resources, pages that work under the Content-Security-Policy, no leaked
// signing key, and (optionally) reproducible builds.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  trustOnFirstUse,
  canonicalBytes,
  validateFriends,
  validateManifest,
  validateOutbox,
  verifyActivity,
} from '../../packages/protocol/src/index.js';
import { attributeOf, childElements, parseXml, textOf } from '../xml/xml.mjs';

export const FIRST_SCREEN_BUDGET = 200 * 1024;
const MAX_PAGES = 1000;

/** @param {string} dir @returns {string[]} */
export function filesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

/** @param {unknown} value */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The file a same-origin URL or path is served from, or null for other origins.
 * @param {string} url @param {string} origin @param {string} [base] page path for relative links
 */
export function fileFor(url, origin, base = '/') {
  let parsed;
  try {
    parsed = new URL(url, `${origin}${base}`);
  } catch {
    return null;
  }
  if (parsed.origin !== origin) return null;
  let path = decodeURIComponent(parsed.pathname);
  if (path.endsWith('/')) path += 'index.html';
  return path.slice(1);
}

/** @param {string} html */
function withoutScripts(html) {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

/** @param {string} html @param {string} tag @param {string} attribute */
function attributeValues(html, tag, attribute) {
  const values = [];
  const element = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const value = new RegExp(`\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  for (const match of html.matchAll(element)) {
    const found = value.exec(match[0]);
    if (found) values.push({ element: match[0], value: (found[1] ?? found[2] ?? found[3]).replace(/&amp;/g, '&') });
  }
  return values;
}

/** @param {string} html */
function textContent(html) {
  return withoutScripts(html)
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} dist
 * @param {object} [options]
 * @param {string} [options.origin] expected origin; defaults to the manifest's id
 * @param {string[]} [options.secrets] strings that must not appear in any file (signing seeds)
 * @param {string} [options.compare] another build of the same sources, for reproducibility
 * @param {'isometric' | 'text'} [options.theme]
 * @returns {Promise<{ problems: string[], summary: Record<string, unknown> }>}
 */
export async function checkSite(dist, options = {}) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Record<string, unknown>} */
  const summary = {};
  if (!existsSync(join(dist, 'index.html'))) return { problems: [`${dist}: no index.html, is this a build?`], summary };
  const files = filesIn(dist).map((path) => relative(dist, path).split(sep).join('/'));
  const fileSet = new Set(files);
  const read = (/** @type {string} */ path) => readFileSync(join(dist, path), 'utf8');
  /** @param {string} path */
  const readJson = (path) => {
    if (!fileSet.has(path)) {
      problems.push(`${path}: missing`);
      return undefined;
    }
    try {
      const value = JSON.parse(read(path));
      if (!isObject(value)) problems.push(`${path}: must be a JSON object`);
      return isObject(value) ? value : undefined;
    } catch (error) {
      problems.push(`${path}: not JSON (${/** @type {Error} */ (error).message})`);
      return undefined;
    }
  };

  // Protocol documents.
  const manifest = readJson('.well-known/island.json');
  const origin = options.origin ?? (typeof manifest?.id === 'string' ? manifest.id : 'https://invalid.invalid');
  summary.origin = origin;
  let manifestValid = false;
  if (manifest) {
    const check = validateManifest(manifest, { fetchedOrigin: origin });
    manifestValid = check.ok;
    if (!check.ok) problems.push(`.well-known/island.json: ${JSON.stringify(check.issues)}`);
    for (const [name, url] of Object.entries(isObject(manifest.links) ? manifest.links : {})) {
      // The inbox and compose page are answered by the island service, not by static files.
      if (name === 'inbox' || name === 'compose') continue;
      const file = fileFor(String(url), origin);
      if (file === null || !fileSet.has(file)) problems.push(`manifest link ${name} (${url}) is not in the build`);
    }
  }

  /** @type {Record<string, any>[]} */
  const activities = [];
  const pagesSeen = new Set();
  let outboxValid = manifestValid;
  let nextUrl = manifestValid ? manifest?.links?.outbox : undefined;
  let snapshot;
  while (typeof nextUrl === 'string') {
    const file = fileFor(nextUrl, origin);
    if (file === null || pagesSeen.has(file) || pagesSeen.size >= MAX_PAGES) {
      problems.push(`outbox chain: ${nextUrl} is on another origin or repeats`);
      outboxValid = false;
      break;
    }
    pagesSeen.add(file);
    const page = readJson(file);
    if (!page) {
      outboxValid = false;
      break;
    }
    const check = validateOutbox(page);
    if (!check.valid) {
      outboxValid = false;
      problems.push(`${file}: ${JSON.stringify([check.issues, check.items.filter((item) => !item.ok)])}`);
      break;
    }
    if (pagesSeen.size === 1) snapshot = page.snapshot;
    activities.push(...page.items);
    nextUrl = page.next;
  }
  for (const file of files.filter((path) => /^island\/outbox(-\d+)?\.json$/.test(path))) {
    if (!pagesSeen.has(file)) problems.push(`${file}: an outbox page that no other page links to`);
  }
  summary.outboxPages = pagesSeen.size;
  summary.activities = activities.length;

  if (outboxValid) {
    const expected = createHash('sha256').update(canonicalBytes(
      [...activities].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )).digest('hex');
    if (snapshot !== expected) problems.push('outbox head snapshot does not match the complete activity set');
  }

  if (manifest && manifestValid && outboxValid) {
    const history = await trustOnFirstUse(manifest, { now: new Date().toISOString() });
    for (const activity of activities) {
      const verified = await verifyActivity(history, activity, { source: 'origin', delivery: false });
      if (!verified.ok) problems.push(`outbox: ${activity.id} does not verify (${verified.reason})`);
    }
  }

  const posts = activities.filter((activity) => activity.type === 'post');
  const deletes = activities.filter((activity) => activity.type === 'delete');
  if (manifest && isObject(manifest.stats?.records)) {
    /** @type {Record<string, number>} */
    const byKind = {};
    for (const post of posts) byKind[post.object.kind] = (byKind[post.object.kind] ?? 0) + 1;
    for (const [kind, count] of Object.entries(manifest.stats.records)) {
      if ((byKind[kind] ?? 0) !== count) problems.push(`manifest stats.records.${kind} is ${count}, the outbox has ${byKind[kind] ?? 0}`);
    }
  }
  for (const post of posts) {
    const file = fileFor(post.object.url, origin);
    if (file === null || !fileSet.has(file)) problems.push(`post ${post.id}: its page ${post.object.url} is not in the build`);
  }
  for (const withdrawn of deletes) {
    const file = fileFor(withdrawn.object.of, origin);
    if (file !== null && fileSet.has(file)) problems.push(`delete ${withdrawn.id}: the withdrawn page ${withdrawn.object.of} is still published`);
  }

  const friends = readJson('island/friends.json');
  if (friends) {
    const check = validateFriends(friends);
    if (!check.ok) problems.push(`island/friends.json: ${JSON.stringify(check.issues)}`);
  }

  // Feed.
  if (!fileSet.has('feed.xml')) {
    problems.push('feed.xml: missing');
  } else {
    try {
      const root = parseXml(readFileSync(join(dist, 'feed.xml')));
      const channel = childElements(root, 'channel')[0];
      if (root.local !== 'rss' || root.namespace !== null || attributeOf(root, 'version') !== '2.0' || !channel) {
        problems.push('feed.xml: not RSS 2.0');
      } else {
        if (textOf(childElements(channel, 'link')[0] ?? { children: [] }) !== `${origin}/`) problems.push('feed.xml: the channel link is not the home page');
        const items = childElements(channel, 'item');
        const expected = Math.min(posts.length, 50);
        if (items.length !== expected) problems.push(`feed.xml: ${items.length} items, expected ${expected}`);
        const postUrls = new Set(posts.map((post) => post.object.url));
        let previous = Infinity;
        for (const item of items) {
          const link = textOf(childElements(item, 'link')[0] ?? { children: [] });
          const guid = childElements(item, 'guid')[0];
          const date = Date.parse(textOf(childElements(item, 'pubDate')[0] ?? { children: [] }) ?? '');
          if (!link || !postUrls.has(link)) problems.push(`feed.xml: item ${link} is not a published record`);
          if (!guid || textOf(guid) !== link) problems.push(`feed.xml: item ${link} needs a guid equal to its link`);
          if (!Number.isFinite(date)) problems.push(`feed.xml: item ${link} has no valid pubDate`);
          if (date > previous) problems.push('feed.xml: items are not newest first');
          previous = date;
        }
        summary.feedItems = items.length;
      }
    } catch (error) {
      problems.push(`feed.xml: not well-formed XML: ${/** @type {Error} */ (error).message}`);
    }
  }

  // Every record readable without JavaScript: follow links from the home page.
  const reached = new Set(['index.html']);
  const queue = ['index.html'];
  while (queue.length > 0) {
    const file = /** @type {string} */ (queue.shift());
    const base = `/${file.replace(/index\.html$/, '')}`;
    for (const { value } of attributeValues(withoutScripts(read(file)), 'a', 'href')) {
      const target = fileFor(value, origin, base);
      if (target && fileSet.has(target) && target.endsWith('.html') && !reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
  }
  for (const post of posts) {
    const file = fileFor(post.object.url, origin);
    if (!file || !fileSet.has(file)) continue;
    if (!reached.has(file)) problems.push(`${post.object.url}: not reachable by links from the home page without JavaScript`);
    const text = textContent(read(file));
    if (post.object.title && !text.includes(post.object.title)) problems.push(`${post.object.url}: the title is not in the page text`);
    if (text.length < 20) problems.push(`${post.object.url}: almost no text without JavaScript`);
  }
  summary.pagesReached = reached.size;

  // Every HTML page: language, the island link, no third-party or inline code.
  const html = files.filter((path) => path.endsWith('.html'));
  let scriptBytes = 0;
  for (const file of html) {
    const page = read(file);
    if (!/<html\b[^>]*\slang="[^"]+"/i.test(page)) problems.push(`${file}: <html> has no lang`);
    if (!/<link\b[^>]*rel="island"[^>]*href="\/\.well-known\/island\.json"/i.test(page)) problems.push(`${file}: no <link rel="island">`);
    for (const { element, value } of [
      ...attributeValues(page, 'script', 'src'),
      ...attributeValues(page, 'link', 'href').filter(({ element }) => /rel="(stylesheet|preload|modulepreload|icon|manifest)"/i.test(element)),
    ]) {
      const target = fileFor(value, origin, `/${file.replace(/index\.html$/, '')}`);
      if (target === null) problems.push(`${file}: loads a third-party resource ${value}`);
      else if (!fileSet.has(target)) problems.push(`${file}: ${element} points to a missing file`);
    }
    for (const script of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attributes = script[1];
      if (/\ssrc=/i.test(attributes)) continue;
      if (/type="application\/(ld\+)?json"/i.test(attributes)) continue;
      problems.push(`${file}: an inline script, which the Content-Security-Policy blocks`);
    }
    if (/<style\b/i.test(page)) problems.push(`${file}: an inline <style>, which the Content-Security-Policy blocks`);
    if (/<[a-z][^>]*\sstyle\s*=/i.test(page)) problems.push(`${file}: a style attribute, which the Content-Security-Policy blocks`);
    if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(page)) problems.push(`${file}: an inline event handler, which the Content-Security-Policy blocks`);
  }
  for (const file of files.filter((path) => path.endsWith('.css'))) {
    for (const match of read(file).matchAll(/(?:url\(\s*["']?|@import\s+["'])(https?:)?\/\/([^"')\s]+)/gi)) {
      problems.push(`${file}: loads a third-party resource //${match[2]}`);
    }
  }
  for (const file of files.filter((path) => /\.m?js$/.test(path))) scriptBytes += statSync(join(dist, file)).size;
  summary.htmlPages = html.length;
  summary.scriptBytes = scriptBytes;

  // A lower bound: HTML and its directly linked CSS/JS. The required browser
  // check enforces the FULL budget, including imports and runtime data fetches.
  const home = read('index.html');
  const assets = [...new Set([
    ...attributeValues(home, 'script', 'src'),
    ...attributeValues(home, 'link', 'href').filter(({ element }) => /rel="(stylesheet|modulepreload)"/i.test(element)),
  ]
    .map(({ value }) => fileFor(value, origin))
    .filter((file) => file !== null && fileSet.has(file)))];
  const firstScreen = [home, ...assets.map((file) => readFileSync(join(dist, /** @type {string} */ (file))))].reduce(
    (sum, content) => sum + gzipSync(content, { level: 9 }).length,
    0,
  );
  summary.firstScreenDirectGzipBytes = firstScreen;
  if (firstScreen > FIRST_SCREEN_BUDGET) problems.push(`first screen is ${firstScreen} bytes gzipped, over the ${FIRST_SCREEN_BUDGET} budget`);

  // Theme expectations.
  if (options.theme === 'isometric' && !/<svg\b[^>]*role="img"/.test(home)) problems.push('isometric theme: the home page has no island picture');
  if (options.theme === 'text') {
    if (/<svg\b/.test(home)) problems.push('text theme: the home page has a picture');
    if (/<script\b/.test(home)) problems.push('text theme: the home page has a script');
  }

  // Hosting files.
  if (!fileSet.has('_headers')) {
    problems.push('_headers: missing');
  } else {
    const headers = read('_headers');
    for (const rule of ['/.well-known/island.json', '/island/*', '/feed.xml']) {
      if (!new RegExp(`^${rule.replace(/[.*]/g, (c) => `\\${c}`)}\\n\\s+Access-Control-Allow-Origin: \\*`, 'm').test(headers)) {
        problems.push(`_headers: ${rule} needs Access-Control-Allow-Origin: *`);
      }
    }
    if (!/Content-Security-Policy: .*script-src 'self'/.test(headers)) problems.push('_headers: no Content-Security-Policy with script-src \'self\'');
  }
  if (!fileSet.has('robots.txt')) {
    problems.push('robots.txt: missing');
  } else if (manifest && isObject(manifest.ai)) {
    const signal = `ai-input=${manifest.ai.read ? 'yes' : 'no'}, ai-train=${manifest.ai.train ? 'yes' : 'no'}`;
    if (!read('robots.txt').includes(signal)) problems.push(`robots.txt: the Content-Signal line does not say ${signal}`);
  }

  // No signing key anywhere.
  for (const secret of (options.secrets ?? []).filter((value) => value.length >= 32)) {
    for (const file of files) {
      const content = readFileSync(join(dist, file));
      if (content.includes(secret) || content.includes(secret.toUpperCase())) problems.push(`${file}: contains the signing key`);
    }
  }

  // Reproducible: the same sources give the same protocol files and feed.
  if (options.compare) {
    const other = new Set(filesIn(options.compare).map((path) => relative(options.compare ?? '', path).split(sep).join('/')));
    for (const file of files.filter((path) => path.startsWith('island/') || path === '.well-known/island.json' || path === 'feed.xml')) {
      if (!other.has(file)) problems.push(`${file}: missing from the second build`);
      else if (!readFileSync(join(dist, file)).equals(readFileSync(join(options.compare, file)))) problems.push(`${file}: differs between two builds of the same sources`);
    }
  }

  return { problems, summary };
}
