// The record statistics in the manifest. Only public records count; the
// growth rules see withdrawn records too (see growth/default.js).

import { isoWeek } from './dates.js';
import { RECORD_KINDS, publicRecords } from './records.js';

/** The manifest schema keeps at most this many active weeks. */
export const ACTIVE_WEEKS_KEPT = 60;

/**
 * @param {import('./records.js').IslandRecord[]} records
 * @returns {{ records: Record<string, number>, firstRecord?: string, lastRecord?: string, activeWeeks: string[] }}
 */
export function recordStats(records) {
  const shown = publicRecords(records);
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(RECORD_KINDS.map((kind) => [kind, 0]));
  for (const record of shown) counts[record.kind] = (counts[record.kind] ?? 0) + 1;
  const dates = shown.map((record) => record.date).sort();
  const weeks = [...new Set(dates.map(isoWeek))].sort();
  return {
    records: counts,
    ...(dates.length > 0 ? { firstRecord: dates[0], lastRecord: dates[dates.length - 1] } : {}),
    activeWeeks: weeks.slice(-ACTIVE_WEEKS_KEPT),
  };
}
