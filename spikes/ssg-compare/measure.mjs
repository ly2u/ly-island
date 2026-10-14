// Installs, builds and measures both generators on the same example island,
// then checks what each produced.
//
//   node spikes/ssg-compare/measure.mjs                  full run (needs the npm registry)
//   node spikes/ssg-compare/measure.mjs --check <dist>…  only the output checks
//
// The full run writes results.json and report.md next to this file (and appends
// the report to $GITHUB_STEP_SUMMARY when set). Both modes exit with 1 when any
// check fails.
//
// Dependencies are resolved fresh from the registry on every run, each tool
// with its own empty npm cache: the numbers are a dated snapshot, and the
// report records the npm version, the platform and a hash of each resolved
// lockfile so that two runs can be compared.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { checkOutputs, PROTOCOL_FILES } from './checks.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TOOLS = ['astro', 'eleventy'];
const BAD_CONTENT = join(ROOT, 'fixtures', 'bad-front-matter');

/** A GitHub annotation, readable through the API even when logs are not. */
function annotate(/** @type {string} */ title, /** @type {string} */ message) {
  if (!process.env.GITHUB_ACTIONS) return;
  const escape = (/** @type {string} */ text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::error title=${escape(title).replace(/[:,]/g, ' ')}::${escape(message).slice(0, 4000)}`);
}

/** @param {string} dir @returns {string[]} */
function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

class StepError extends Error {}

/**
 * @param {string} command @param {string[]} args @param {string} cwd @param {Record<string, string>} [env]
 */
function run(command, args, cwd, env = {}) {
  const start = performance.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', NO_COLOR: '1', ...env },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  return { status: result.status, output, ms: Math.round(performance.now() - start) };
}

/** Like run, but a failing command stops this tool's measurement. */
function timed(/** @type {Parameters<typeof run>} */ ...params) {
  const result = run(...params);
  if (result.status !== 0) {
    const tail = result.output.trim().split('\n').slice(-40).join('\n');
    throw new StepError(`${params[0]} ${params[1].join(' ')} exited with ${result.status}\n${tail}`);
  }
  return result.ms;
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

/** The lockfile npm resolved during this run, as a short hash and a package count. */
function lockfile(/** @type {string} */ dir) {
  const path = join(dir, 'package-lock.json');
  if (!existsSync(path)) return null;
  const text = readFileSync(path);
  const lock = JSON.parse(text.toString('utf8'));
  return {
    sha256: createHash('sha256').update(text).digest('hex').slice(0, 16),
    packages: Object.keys(lock.packages ?? {}).filter((key) => key !== '').length,
  };
}

function environment() {
  const npm = spawnSync('npm', ['--version'], { encoding: 'utf8' });
  return {
    node: process.version,
    npm: npm.stdout?.trim() || 'unknown',
    platform: `${platform()} ${release()} ${arch()}`,
    cpu: `${cpus()[0]?.model ?? 'unknown'} × ${cpus().length}`,
    date: new Date().toISOString(),
  };
}

async function measure() {
  const env = environment();
  /** @type {Record<string, any>} */
  const results = {};
  let failed = false;

  for (const tool of TOOLS) {
    const dir = join(ROOT, tool);
    for (const path of ['node_modules', 'dist', '.astro', 'package-lock.json']) {
      rmSync(join(dir, path), { recursive: true, force: true });
    }
    // Each tool gets its own empty cache, so the order of the tools does not matter.
    const cache = mkdtempSync(join(tmpdir(), `ssg-compare-${tool}-npm-cache-`));

    let installMs;
    let buildMs;
    let rebuildMs;
    try {
      installMs = timed('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], dir, { npm_config_cache: cache });
      buildMs = timed('npm', ['run', 'build', '--silent'], dir);
      rebuildMs = timed('npm', ['run', 'build', '--silent'], dir);
    } catch (error) {
      if (!(error instanceof StepError)) throw error;
      failed = true;
      annotate(`${tool} failed`, error.message);
      results[tool] = { failure: error.message };
      continue;
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }

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
    results[tool] = {
      packages: packageCount(dir),
      lockfile: lockfile(dir),
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
      feedBytes: existsSync(join(dist, 'feed.xml')) ? statSync(join(dist, 'feed.xml')).size : null,
      protocol: Object.fromEntries(
        PROTOCOL_FILES.map((path) => {
          const full = join(dist, path);
          return [path, existsSync(full) ? createHash('sha256').update(readFileSync(full)).digest('hex') : null];
        }),
      ),
      problems,
    };

    // A note with an unknown kind must stop the build, for the right reason.
    const bad = run('npm', ['run', 'build', '--silent'], dir, { SPIKE_CONTENT: BAD_CONTENT });
    const rejected = bad.status !== 0 && bad.output.includes('kind');
    results[tool].rejectsBadFrontMatter = rejected;
    if (!rejected) {
      problems.push(
        bad.status === 0
          ? 'built a note whose kind is not article, note or project'
          : `the bad note failed the build without naming "kind" (exit ${bad.status})`,
      );
    }
    // Leave the normal output in dist for the artifact.
    run('npm', ['run', 'build', '--silent'], dir);

    if (problems.length > 0) failed = true;
    for (const problem of problems) annotate(`${tool} output`, problem);
  }

  const built = TOOLS.filter((tool) => !results[tool].failure);
  let identical = null;
  if (built.length === TOOLS.length) {
    const first = JSON.stringify(results[TOOLS[0]].protocol);
    identical = TOOLS.every((tool) => JSON.stringify(results[tool].protocol) === first);
    if (!identical) {
      failed = true;
      annotate('protocol files differ', 'the generators produced different protocol files from the same module');
    }
  }

  writeFileSync(join(ROOT, 'results.json'), `${JSON.stringify({ environment: env, identical, results }, null, 2)}\n`);

  const kb = (/** @type {number} */ v, digits = 1) => `${(v / 1024).toFixed(digits)} KB`;
  /** @type {[string, string, (v: any, r: any) => string][]} */
  const rows = [
    ['Installed packages', 'packages', (v) => String(v)],
    ['Resolved lockfile (sha256 prefix, packages)', 'lockfile', (v) => (v ? `\`${v.sha256}\`, ${v.packages}` : 'none')],
    ['node_modules size', 'nodeModulesBytes', (v) => `${(v / 1024 / 1024).toFixed(1)} MB`],
    ['Install time (reference only)', 'installMs', (v) => `${(v / 1000).toFixed(1)} s`],
    ['First build', 'buildMs', (v) => `${(v / 1000).toFixed(1)} s`],
    ['Second build', 'rebuildMs', (v) => `${(v / 1000).toFixed(1)} s`],
    ['Output files', 'outputFiles', (v) => String(v)],
    ['Output size', 'outputBytes', (v) => kb(v)],
    ['Feed size (summary-only RSS)', 'feedBytes', (v) => (v === null ? 'missing' : kb(v, 2))],
    ['CSS files / bytes', 'cssFiles', (v, r) => `${v} / ${kb(r.cssBytes)}`],
    ['JS files / bytes', 'jsFiles', (v, r) => `${v} / ${kb(r.jsBytes)}`],
    ['<script> tags in HTML', 'scriptTags', (v) => String(v)],
    ['HTML+CSS+JS gzip', 'htmlCssJsGzipBytes', (v) => kb(v)],
    ['Home page gzip', 'homeGzipBytes', (v) => (v === null ? 'missing' : kb(v, 2))],
    ['Article page gzip', 'articleGzipBytes', (v) => (v === null ? 'missing' : kb(v, 2))],
    ['Build fails on a bad front matter `kind`', 'rejectsBadFrontMatter', (v) => (v ? 'yes' : 'NO')],
    ['Output checks (protocol, strict feed, pages)', 'problems', (v) => (v.length === 0 ? 'pass' : `FAIL: ${v.join('; ')}`)],
  ];
  const cell = (/** @type {string} */ tool, /** @type {typeof rows[number]} */ row) =>
    results[tool].failure ? 'build failed' : row[2](results[tool][row[1]], results[tool]);
  const table = [
    `| Measure | ${TOOLS.join(' | ')} |`,
    `| --- | ${TOOLS.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row[0]} | ${TOOLS.map((tool) => cell(tool, row)).join(' | ')} |`),
  ].join('\n');
  const failures = TOOLS.filter((tool) => results[tool].failure)
    .map((tool) => `\n### ${tool} failed\n\n\`\`\`\n${results[tool].failure}\n\`\`\`\n`)
    .join('');
  const sameProtocol =
    identical === null ? 'not compared (a build failed)' : identical ? 'byte-identical in both builds' : '**DIFFERENT**';

  const report = [
    '## Static generator comparison',
    '',
    `Node ${env.node}, npm ${env.npm}, ${env.platform}, ${env.cpu}, ${env.date}.`,
    '',
    'Rolling snapshot: dependencies were resolved fresh from the registry, each tool with its own empty npm cache. ' +
      'Install time depends on the network and is for reference only.',
    '',
    table,
    '',
    `Protocol files: ${sameProtocol}.`,
    failures,
  ].join('\n');
  console.log(report);
  writeFileSync(join(ROOT, 'report.md'), report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  process.exitCode = failed ? 1 : 0;
}

const args = process.argv.slice(2);
if (args[0] === '--check') {
  const dists = args.slice(1);
  if (dists.length === 0) throw new Error('usage: measure.mjs --check <dist>…');
  let failed = false;
  for (const dist of dists) {
    const problems = await checkOutputs(dist);
    console.log(`${dist}: ${problems.length === 0 ? 'pass' : `${problems.length} problems`}`);
    for (const problem of problems) {
      console.log(`  ${problem}`);
      annotate(`${dist} output`, problem);
    }
    failed ||= problems.length > 0;
  }
  process.exitCode = failed ? 1 : 0;
} else {
  await measure();
}
