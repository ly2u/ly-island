// Growth rules by id. Another island's stats are drawn with the rules it
// names when they are known here, and with default@0 otherwise: growth is
// only decoration, so a fallback is always safe.

import * as defaultRules from './default.js';

/** @type {Record<string, typeof defaultRules>} */
export const RULES = Object.freeze({ [defaultRules.id]: defaultRules });
export const DEFAULT_RULES = defaultRules.id;

/** @param {string} id */
export function rulesFor(id) {
  const rules = RULES[id];
  if (!rules) throw new TypeError(`unknown growth rules ${id}; known: ${Object.keys(RULES).join(', ')}`);
  return rules;
}

/**
 * The time-dependent view of any island's stats, with that island's rules when known.
 * @param {any} stats @param {string} today
 */
export function presentStats(stats, today) {
  const rules = RULES[stats?.growth?.rules] ?? defaultRules;
  return rules.present(stats, today);
}

/**
 * Adds what is unlocked now to the ledger, keeping every existing entry.
 * Used by the owner's tool before switching rules or deleting a record file.
 * @param {import('./default.js').UnlockLedger} ledger
 * @param {string[]} unlocked
 * @param {string} rules
 * @param {string} today YYYY-MM-DD
 */
export function mergeLedger(ledger, unlocked, rules, today) {
  defaultRules.checkLedger(ledger);
  const known = new Set(ledger.unlocked.map((entry) => entry.id));
  const added = unlocked.filter((id) => !known.has(id)).map((id) => ({ id, since: today, rules }));
  return { ledger: { unlocked: [...ledger.unlocked, ...added] }, added: added.map((entry) => entry.id) };
}

export { defaultRules };
