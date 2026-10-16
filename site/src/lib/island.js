// Everything the pages need, computed once per build: settings, records,
// growth, and the signed protocol documents.

import { execFileSync } from 'node:child_process';
import { getCollection } from 'astro:content';

import {
  buildFeed,
  buildIsland,
  buildRobots,
  dateTime,
  islandSigner,
  normalizeRecords,
  publicRecords,
} from '../../../packages/core/src/index.js';
import { loadConfig, readJson } from './config.js';

/**
 * When the sources last changed: SOURCE_DATE_EPOCH if set (reproducible
 * builds), else the last commit, else nothing (the newest record wins).
 */
function sourceDate() {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch)) return dateTime(new Date(Number(epoch) * 1000));
  try {
    const committed = execFileSync('git', ['log', '-1', '--format=%cI'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (committed) return dateTime(committed);
  } catch {
    // Not a Git checkout.
  }
  return '1970-01-01T00:00:00Z';
}

async function load() {
  const config = loadConfig();
  const entries = await getCollection('records');
  const records = normalizeRecords(
    entries.map((entry) => ({ slug: entry.id, ...entry.data, html: entry.rendered?.html ?? '' })),
    { origin: config.origin, timeZone: config.timeZone, language: config.language[0] },
  );
  const signer = await islandSigner(process.env, { origin: config.origin, keyName: config.keyName, dev: import.meta.env.DEV });
  if (signer.test) console.warn('[island] Signed with the PUBLIC TEST KEY. Fine for the dev server and CI, never for a real island.');
  const built = await buildIsland({
    config,
    records,
    friends: readJson('island/friends.json'),
    ledger: readJson('island/unlocks.json'),
    signer,
    sourceDate: sourceDate(),
  });
  return {
    config,
    records,
    shown: publicRecords(records),
    entries: new Map(entries.map((entry) => [entry.id, entry])),
    feed: buildFeed({ config, records }),
    robots: buildRobots(config.ai),
    ...built,
  };
}

/** @type {ReturnType<typeof load> | undefined} */
let cached;
export function island() {
  cached ??= load();
  return cached;
}

/** @param {unknown} value */
export function json(value) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json; charset=utf-8' } });
}
