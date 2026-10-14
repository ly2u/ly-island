// Saves what is unlocked now into island/unlocks.json, the unlock ledger.
//
//   npm run build && npm run unlocks:save
//
// Do this before switching growth rules, and before deleting a record file
// for good (withdrawing a record does not need it). Commit the result.
// See docs/extensions.md, "已解锁的外观怎么保住".

import { readFileSync, writeFileSync } from 'node:fs';

import { localDate, mergeLedger } from '../../packages/core/src/index.js';
import { loadConfig, readJson } from '../src/lib/config.js';

let manifest;
try {
  manifest = JSON.parse(readFileSync('dist/.well-known/island.json', 'utf8'));
} catch {
  console.error('Build first: npm run build');
  process.exit(1);
}
const growth = manifest?.stats?.growth;
if (!growth || !Array.isArray(growth.unlocked)) {
  console.error('dist/.well-known/island.json has no stats.growth; rebuild and try again.');
  process.exit(1);
}

const config = loadConfig();
const today = localDate(new Date(), config.timeZone);
const { ledger, added } = mergeLedger(readJson('island/unlocks.json'), growth.unlocked, growth.rules, today);
writeFileSync('island/unlocks.json', `${JSON.stringify(ledger, null, 2)}\n`);
console.log(added.length > 0 ? `Saved: ${added.join(', ')}. Commit island/unlocks.json.` : 'Nothing new to save.');
