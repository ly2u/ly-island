// Writes wrangler.generated.json: wrangler.jsonc plus what differs per island.
//
//   node scripts/wrangler-config.mjs        (npm run deploy does this)
//
// - triggers.crons: four runs an hour at minutes spread by hash(origin), so
//   islands do not all fetch at the same moment (protocol "频率与批次");
// - name: ISLAND_WORKER_NAME, when one repository deploys several islands
//   (for example a second test island);
// - the D1 database name follows the Worker name, so two islands in one
//   account never share data;
// - vars.ISLAND_TIME_ZONE: the island's time zone, for notification times.
//
// The settings file is island.config.json, or ISLAND_CONFIG when set.

import { readFileSync, writeFileSync } from 'node:fs';

import { checkPolicy } from '../../packages/worker/src/notify.js';
import { cronFor } from '../../packages/worker/src/util.js';
import { loadConfig, readJson } from '../src/lib/config.js';

/** JSON with whole-line // comments, as wrangler.jsonc is written here. @param {string} text */
function parseJsonc(text) {
  return JSON.parse(text.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n'));
}

const base = parseJsonc(readFileSync('wrangler.jsonc', 'utf8'));
const island = loadConfig();
// A wrong notification policy fails the deploy here, not every request later.
checkPolicy(readJson('island/notify.json'), island.timeZone);
const name = process.env.ISLAND_WORKER_NAME || base.name;
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new Error('ISLAND_WORKER_NAME must be lowercase letters, digits and "-"');

const generated = {
  ...base,
  name,
  triggers: { crons: [cronFor(island.origin)] },
  vars: { ...base.vars, ISLAND_TIME_ZONE: island.timeZone },
  d1_databases: base.d1_databases.map((/** @type {Record<string, string>} */ db) => ({ ...db, database_name: `${name}-data` })),
};
delete generated.$schema;
writeFileSync('wrangler.generated.json', `${JSON.stringify(generated, null, 2)}\n`);
console.log(`wrangler.generated.json: ${name}, cron "${generated.triggers.crons[0]}", database ${name}-data, island ${island.origin}`);
