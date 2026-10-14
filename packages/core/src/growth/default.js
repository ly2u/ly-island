// Growth rules default@0. See docs/extensions.md#成长规则.
//
// Two pure functions: accumulate() runs at build time on the repository's
// records and unlock ledger; present() runs in the browser because it depends
// on today's date. Neither reads the clock, the network or random numbers.

import { isCalendarDate, isoWeek, weekNumber } from '../dates.js';

export const id = 'default@0';

export const DEFAULT_CONFIG = Object.freeze({
  notePoints: 1,
  noteDailyLimit: 3,
  articlePoints: 3,
  projectPoints: 5,
  projectDoneBonus: 10,
  growingAt: 30,
  flourishingAt: 100,
  decorationEvery: 100,
});

export const STAGES = Object.freeze(['seed', 'growing', 'flourishing']);
/** Small decorations unlocked every `decorationEvery` points after flourishing, in order. */
export const DECORATIONS = Object.freeze(['lantern', 'windmill', 'lighthouse-small', 'bridge', 'observatory']);
const MAX_UNLOCKED = 256;
const FAR_FUTURE = '9999-12-31';

/**
 * @typedef {{ kind: string, date: string, done?: string, withdrawn?: string }} RecordFact dates are local YYYY-MM-DD
 * @typedef {{ unlocked: { id: string, since: string, rules: string }[] }} UnlockLedger
 * @typedef {{ points: number, stage: string, unlocked: string[], next?: { stage: string, points: number } }} GrowthState
 * @typedef {GrowthState & { streakWeeks: number, longestWeeks: number, vitality: number }} GrowthView
 */

/**
 * The rule parameters, with defaults filled in. Unknown keys and values that
 * are not positive whole numbers are errors.
 * @param {Record<string, unknown>} [config]
 * @returns {typeof DEFAULT_CONFIG}
 */
export function checkConfig(config = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('growth config must be an object');
  for (const [key, value] of Object.entries(config)) {
    if (!Object.hasOwn(DEFAULT_CONFIG, key)) throw new TypeError(`unknown growth setting ${key} for ${id}`);
    if (!Number.isInteger(value) || /** @type {number} */ (value) < 1 || /** @type {number} */ (value) > 1_000_000) {
      throw new TypeError(`growth setting ${key} must be a whole number from 1 to 1000000`);
    }
  }
  const merged = { ...DEFAULT_CONFIG, ...config };
  if (merged.flourishingAt <= merged.growingAt) throw new TypeError('flourishingAt must be greater than growingAt');
  return /** @type {typeof DEFAULT_CONFIG} */ (Object.freeze(merged));
}

/** @param {number} points @param {typeof DEFAULT_CONFIG} config */
export function stageFor(points, config = DEFAULT_CONFIG) {
  if (points >= config.flourishingAt) return 'flourishing';
  if (points >= config.growingAt) return 'growing';
  return 'seed';
}

/** @param {number} index 0-based */
function decorationId(index) {
  return DECORATIONS[index] ?? `decoration-${index + 1}`;
}

/**
 * Everything a score unlocks, in the order it is unlocked.
 * @param {number} points @param {typeof DEFAULT_CONFIG} config
 */
export function unlocksFor(points, config = DEFAULT_CONFIG) {
  const unlocked = [];
  if (points >= config.growingAt) unlocked.push('stage-growing');
  if (points >= config.flourishingAt) unlocked.push('stage-flourishing');
  for (let k = 1; config.flourishingAt + k * config.decorationEvery <= points && unlocked.length < MAX_UNLOCKED; k += 1) {
    unlocked.push(decorationId(k - 1));
  }
  return unlocked;
}

/**
 * Points of the records that were public on `day` (inclusive). A record counts
 * from its date until the day before it was withdrawn.
 * @param {RecordFact[]} facts @param {string} day @param {typeof DEFAULT_CONFIG} config
 */
export function pointsOn(facts, day, config = DEFAULT_CONFIG) {
  let points = 0;
  /** @type {Map<string, number>} */
  const notesPerDay = new Map();
  for (const fact of facts) {
    if (fact.date > day || (fact.withdrawn !== undefined && fact.withdrawn <= day)) continue;
    if (fact.kind === 'note') {
      notesPerDay.set(fact.date, (notesPerDay.get(fact.date) ?? 0) + 1);
    } else if (fact.kind === 'article') {
      points += config.articlePoints;
    } else if (fact.kind === 'project') {
      points += config.projectPoints;
      if (fact.done !== undefined && fact.done <= day) points += config.projectDoneBonus;
    }
  }
  for (const count of notesPerDay.values()) points += Math.min(count, config.noteDailyLimit) * config.notePoints;
  return points;
}

/** @param {unknown} ledger @returns {UnlockLedger} */
export function checkLedger(ledger) {
  const fail = (/** @type {string} */ message) => {
    throw new TypeError(`unlock ledger: ${message}`);
  };
  if (ledger === null || typeof ledger !== 'object' || Array.isArray(ledger)) fail('must be an object');
  const { unlocked } = /** @type {any} */ (ledger);
  if (!Array.isArray(unlocked)) fail('unlocked must be a list');
  if (unlocked.length > MAX_UNLOCKED) fail(`at most ${MAX_UNLOCKED} entries`);
  for (const entry of unlocked) {
    if (entry === null || typeof entry !== 'object') fail('every entry must be an object');
    if (typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id)) fail(`bad id ${JSON.stringify(entry.id)}`);
    if (typeof entry.since !== 'string' || !isCalendarDate(entry.since)) fail(`${entry.id}: since must be a date`);
    if (typeof entry.rules !== 'string' || entry.rules.length === 0 || entry.rules.length > 64) fail(`${entry.id}: rules must name the rules`);
  }
  return /** @type {UnlockLedger} */ (ledger);
}

/**
 * Build-time part. Points count only records that are public now; unlocks are
 * the union of the ledger and everything the record history ever reached, so
 * withdrawing a record never takes an unlock back.
 * @param {{ records: RecordFact[], ledger: UnlockLedger }} input
 * @param {Record<string, unknown>} [rawConfig]
 * @returns {GrowthState}
 */
export function accumulate({ records, ledger }, rawConfig = {}) {
  const config = checkConfig(rawConfig);
  checkLedger(ledger);
  const points = pointsOn(records, FAR_FUTURE, config);
  const days = new Set();
  for (const fact of records) {
    days.add(fact.date);
    if (fact.done !== undefined) days.add(fact.done);
    if (fact.withdrawn !== undefined) days.add(fact.withdrawn);
  }
  let best = points;
  for (const day of days) best = Math.max(best, pointsOn(records, day, config));

  const unlocked = [...unlocksFor(best, config)];
  for (const entry of ledger.unlocked) {
    if (!unlocked.includes(entry.id) && unlocked.length < MAX_UNLOCKED) unlocked.push(entry.id);
  }
  return { points, stage: stageFor(points, config), unlocked, ...nextStage(points, config) };
}

/** @param {number} points @param {typeof DEFAULT_CONFIG} config */
function nextStage(points, config) {
  if (points < config.growingAt) return { next: { stage: 'growing', points: config.growingAt } };
  if (points < config.flourishingAt) return { next: { stage: 'flourishing', points: config.flourishingAt } };
  return {};
}

/** @param {unknown} value */
const isCount = (value) => Number.isInteger(value) && /** @type {number} */ (value) >= 0;

/**
 * Browser part: what changes with today's date. Works on any island's
 * manifest stats, so every input is treated as untrusted.
 * - streakWeeks: consecutive weeks with records, ending this week, or last
 *   week when nothing is written yet this week;
 * - longestWeeks: the longest such run in the weeks the manifest lists;
 * - vitality: 1 when the last record is from this or last week, 0.6 after two
 *   or three quiet weeks, 0.3 after four to seven, 0.1 after eight or more;
 *   0.6 before the first record. It never reaches 0.
 * @param {any} stats manifest `stats`
 * @param {string} today local date, YYYY-MM-DD
 * @param {Record<string, unknown>} [rawConfig]
 * @returns {GrowthView}
 */
export function present(stats, today, rawConfig = {}) {
  if (!isCalendarDate(today)) throw new RangeError(`today must be a date, not ${JSON.stringify(today)}`);
  const config = checkConfig(rawConfig);
  const growth = stats !== null && typeof stats === 'object' ? stats.growth : undefined;
  const points = isCount(growth?.points) ? growth.points : 0;
  const stage = typeof growth?.stage === 'string' && growth.stage.length <= 32 ? growth.stage : stageFor(points, config);
  const unlocked = Array.isArray(growth?.unlocked)
    ? growth.unlocked.filter((/** @type {unknown} */ item) => typeof item === 'string' && item.length <= 64).slice(0, MAX_UNLOCKED)
    : [];

  const weekList = Array.isArray(stats?.activeWeeks) ? stats.activeWeeks.slice(0, 60) : [];
  const weeks = new Set(weekList.map(weekNumber).filter((/** @type {number | null} */ n) => n !== null));
  const current = /** @type {number} */ (weekNumber(isoWeek(today)));

  let streakWeeks = 0;
  let cursor = weeks.has(current) ? current : weeks.has(current - 1) ? current - 1 : null;
  while (cursor !== null && weeks.has(cursor)) {
    streakWeeks += 1;
    cursor -= 1;
  }

  let longestWeeks = 0;
  let run = 0;
  let previous = null;
  for (const week of [...weeks].sort((a, b) => a - b)) {
    run = previous !== null && week === previous + 1 ? run + 1 : 1;
    longestWeeks = Math.max(longestWeeks, run);
    previous = week;
  }

  const lastWeeks = [...weeks];
  if (typeof stats?.lastRecord === 'string' && isCalendarDate(stats.lastRecord)) {
    lastWeeks.push(/** @type {number} */ (weekNumber(isoWeek(stats.lastRecord))));
  }
  let vitality = 0.6;
  if (lastWeeks.length > 0) {
    const quiet = current - Math.max(...lastWeeks);
    vitality = quiet <= 1 ? 1 : quiet <= 3 ? 0.6 : quiet <= 7 ? 0.3 : 0.1;
  }

  return { points, stage, unlocked, ...nextStage(points, config), streakWeeks, longestWeeks, vitality };
}
