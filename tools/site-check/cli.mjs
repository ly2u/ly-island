// node tools/site-check/cli.mjs <dist> [--compare <dist>] [--theme isometric|text] [--origin https://...]
//
// Exits with 1 when any check fails. The signing key in ISLAND_SIGNING_KEY,
// and the public test key, must not appear in any built file.

import { TEST_SEED } from '../../packages/core/src/index.js';
import { checkSite } from './checks.mjs';

const args = process.argv.slice(2);
const dist = args[0];
if (!dist || dist.startsWith('--')) throw new Error('usage: cli.mjs <dist> [--compare <dist>] [--theme isometric|text] [--origin <origin>]');
const option = (/** @type {string} */ name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const secrets = [TEST_SEED, process.env.ISLAND_SIGNING_KEY?.trim().toLowerCase()].filter((value) => typeof value === 'string' && value !== '');

const { problems, summary } = await checkSite(dist, {
  compare: option('--compare'),
  theme: /** @type {any} */ (option('--theme')),
  origin: option('--origin'),
  secrets: /** @type {string[]} */ (secrets),
});

const escape = (/** @type {string} */ text) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const line = Object.entries(summary).map(([key, value]) => `${key}=${value}`).join(', ');
console.log(`${dist}: ${problems.length === 0 ? 'pass' : `${problems.length} problems`} (${line})`);
for (const problem of problems) console.log(`  ${problem}`);
if (process.env.GITHUB_ACTIONS) {
  console.log(`::notice title=site check ${escape(String(option('--theme') ?? ''))}::${escape(`${problems.length} problems; ${line}`)}`);
  for (const problem of problems.slice(0, 40)) console.log(`::error title=site check::${escape(problem).slice(0, 4000)}`);
}
process.exitCode = problems.length === 0 ? 0 : 1;
