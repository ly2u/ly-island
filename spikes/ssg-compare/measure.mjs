// Installs, builds and measures both generators on the same example island,
// then checks that each produced the same protocol documents.
//
//   node spikes/ssg-compare/measure.mjs
//
// Writes spikes/ssg-compare/results.json and prints a Markdown table (also
// appended to $GITHUB_STEP_SUMMARY when set). Exits with 1 if any output check fails.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import {
  trustOnFirstUse,
  validateFriends,
  validateManifest,
  validateOutbox,
  verifyActivity,
} from '../../packages/protocol/src/index.js';
import { SITE } from './shared/island-data.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TOOLS = ['astro', 'eleventy'];
const SLUGS = readdirSync(join(ROOT, 'content'))
  .filter((name) => name.endsWith('.md'))
  .map((name) => name.slice(0, -3));

/** @param {string} dir @returns {string[]} */
function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

/** @param {string} command @param {string[]} args @param {string} cwd */
function timed(command, args, cwd) {
  const start = performance.now();
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } });
  return Math.round(performance.now() - start);
}

/** @param {string} dir */
function packageCount(dir) {
  // Every installed package has a package.json directly under a node_modules folder.
  return files(join(dir, 'node_modules')).filter((path) => {
    const parts = relative(dir, path).split(/[\\/]/);
    if (parts.at(-1) !== 'package.json') return false;
    const parent = parts.at(-2) ?? '';
    const grand = parts.at(-3) ?? '';
    return grand === 'node_modules' || (grand.startsWith('@') && parts.at(-4) === 'node_modules' && parent !== '');
  }).length;
}

/** @param {string[]} list */
function bytes(list) {
  return list.reduce((sum, path) => sum + statSync(path).size, 0);
}

/** @param {string[]} list */
function gzipBytes(list) {
  return list.reduce((sum, path) => sum + gzipSync(readFileSync(path), { level: 9 }).length, 0);
}

/**
 * Checks that the build produced what the protocol needs.
 * @param {string} dist
 * @returns {Promise<string[]>} problems
 */
async function checkOutputs(dist) {
  const problems = [];
  const read = (/** @type {string} */ path) => {
    const full = join(dist, path);
    if (!existsSync(full)) {
      problems.push(`missing ${path}`);
      return null;
    }
    return readFileSync(full, 'utf8');
  };
  const json = (/** @type {string} */ path) => {
    const text = read(path);
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      problems.push(`${path}: ${/** @type {Error} */ (error).message}`);
      return null;
    }
  };

  const manifest = json('.well-known/island.json');
  const outbox = json('island/outbox.json');
  const friends = json('island/friends.json');
  if (manifest) {
    const result = validateManifest(manifest, { fetchedOrigin: SITE });
    if (!result.ok) problems.push(`manifest: ${JSON.stringify(result.issues)}`);
  }
  if (outbox) {
    const result = validateOutbox(outbox);
    if (!result.valid) problems.push(`outbox: ${JSON.stringify([result.issues, result.items])}`);
    if (outbox.items?.length !== SLUGS.length) problems.push(`outbox: expected ${SLUGS.length} items`);
    if (manifest && result.valid) {
      const history = await trustOnFirstUse(manifest, { now: new Date().toISOString() });
      for (const item of outbox.items) {
        const verified = await verifyActivity(history, item, { source: 'origin', delivery: false });
        if (!verified.ok) problems.push(`outbox item ${item.id}: ${verified.reason}`);
      }
    }
  }
  if (friends) {
    const result = validateFriends(friends);
    if (!result.ok) problems.push(`friends: ${JSON.stringify(result.issues)}`);
  }

  const feed = read('feed.xml');
  if (feed !== null && (feed.match(/<item>/g) ?? []).length !== SLUGS.length) {
    problems.push(`feed.xml: expected ${SLUGS.length} items`);
  }
  for (const slug of SLUGS) {
    const page = read(`notes/${slug}/index.html`);
    if (page !== null && !page.includes('<table')) {
      if (slug === 'first-bridge') problems.push(`notes/${slug}: the Markdown table did not render`);
    }
  }
  if (read('index.html') !== null && !read('index.html')?.includes('<svg')) problems.push('index.html: no island picture');
  return problems;
}

const results = {};
let failed = false;

for (const tool of TOOLS) {
  const dir = join(ROOT, tool);
  rmSync(join(dir, 'node_modules'), { recursive: true, force: true });
  rmSync(join(dir, 'dist'), { recursive: true, force: true });
  rmSync(join(dir, 'package-lock.json'), { force: true });

  const installMs = timed('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], dir);
  const buildMs = timed('npm', ['run', 'build', '--silent'], dir);
  const rebuildMs = timed('npm', ['run', 'build', '--silent'], dir);

  const dist = join(dir, 'dist');
  const all = files(dist);
  const byExt = (/** @type {string} */ ext) => all.filter((path) => path.endsWith(ext));
  const html = byExt('.html');
  const css = byExt('.css');
  const js = byExt('.js').concat(byExt('.mjs'));
  const scripts = html.reduce((sum, path) => sum + (readFileSync(path, 'utf8').match(/<script\b/g) ?? []).length, 0);
  const pageBytes = (/** @type {string} */ path) => {
    const full = join(dist, path);
    return existsSync(full) ? gzipSync(readFileSync(full), { level: 9 }).length : null;
  };

  const problems = await checkOutputs(dist);
  if (problems.length > 0) failed = true;

  results[tool] = {
    packages: packageCount(dir),
    nodeModulesBytes: bytes(files(join(dir, 'node_modules'))),
    installMs,
    buildMs,
    rebuildMs,
    outputFiles: all.length,
    outputBytes: bytes(all),
    htmlBytes: bytes(html),
    cssFiles: css.length,
    cssBytes: bytes(css),
    jsFiles: js.length,
    jsBytes: bytes(js),
    scriptTags: scripts,
    htmlCssJsGzipBytes: gzipBytes([...html, ...css, ...js]),
    homeGzipBytes: pageBytes('index.html'),
    articleGzipBytes: pageBytes('notes/first-bridge/index.html'),
    problems,
  };
}

writeFileSync(join(ROOT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);

const rows = [
  ['Installed packages', 'packages', (v) => String(v)],
  ['node_modules size', 'nodeModulesBytes', (v) => `${(v / 1024 / 1024).toFixed(1)} MB`],
  ['Install time', 'installMs', (v) => `${(v / 1000).toFixed(1)} s`],
  ['First build', 'buildMs', (v) => `${(v / 1000).toFixed(1)} s`],
  ['Second build', 'rebuildMs', (v) => `${(v / 1000).toFixed(1)} s`],
  ['Output files', 'outputFiles', (v) => String(v)],
  ['Output size', 'outputBytes', (v) => `${(v / 1024).toFixed(1)} KB`],
  ['CSS files / bytes', 'cssFiles', (v, r) => `${v} / ${(r.cssBytes / 1024).toFixed(1)} KB`],
  ['JS files / bytes', 'jsFiles', (v, r) => `${v} / ${(r.jsBytes / 1024).toFixed(1)} KB`],
  ['<script> tags in HTML', 'scriptTags', (v) => String(v)],
  ['HTML+CSS+JS gzip', 'htmlCssJsGzipBytes', (v) => `${(v / 1024).toFixed(1)} KB`],
  ['Home page gzip', 'homeGzipBytes', (v) => (v === null ? 'missing' : `${(v / 1024).toFixed(2)} KB`)],
  ['Article page gzip', 'articleGzipBytes', (v) => (v === null ? 'missing' : `${(v / 1024).toFixed(2)} KB`)],
  ['Protocol and output checks', 'problems', (v) => (v.length === 0 ? 'pass' : `FAIL: ${v.join('; ')}`)],
];
const table = [
  `| Measure | ${TOOLS.join(' | ')} |`,
  `| --- | ${TOOLS.map(() => '---').join(' | ')} |`,
  ...rows.map(([label, key, format]) => `| ${label} | ${TOOLS.map((tool) => format(results[tool][key], results[tool])).join(' | ')} |`),
].join('\n');

const report = `## Static generator comparison\n\nNode ${process.version}, ${new Date().toISOString()}\n\n${table}\n`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
process.exit(failed ? 1 : 0);
