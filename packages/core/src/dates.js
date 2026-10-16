// Calendar helpers. Records keep the author's local date: a front matter date
// without a time is that day; a date with a time is converted to the island's
// time zone. Weeks are ISO 8601 weeks (Monday first).

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/;
const WEEK = /^(\d{4})-W(\d{2})$/;

/** @param {string} value */
export function isCalendarDate(value) {
  const match = DATE.exec(value);
  if (!match || match[0] !== value) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** A real calendar date or an RFC 3339 instant with an explicit offset. No coercion. */
export function isRecordDate(value) {
  if (typeof value !== 'string') return false;
  if (isCalendarDate(value)) return true;
  const match = TIMESTAMP.exec(value);
  return !!match && match[0] === value && isCalendarDate(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60
    && Number(match[4]) < 60 && Number(match[6] ?? 0) < 24 && Number(match[7] ?? 0) < 60
    && Number.isFinite(Date.parse(value));
}

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatters = new Map();

/** A cached formatter for wall-clock parts in a time zone (creating one is slow). @param {string} timeZone */
function formatter(timeZone) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(timeZone, format);
  }
  return format;
}

/** Wall-clock parts of an instant in a time zone, as numbers. @param {number} time @param {string} timeZone */
function wallParts(time, timeZone) {
  /** @type {Record<string, number>} */
  const parts = {};
  for (const part of formatter(timeZone).formatToParts(new Date(time))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts;
}

/** @param {string} timeZone */
export function isTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The local calendar date of a record date.
 * - "2026-10-01" (string) is that day;
 * - a timestamp string or Date is an instant, converted to `timeZone`.
 * The loader preserves date-only YAML scalars as strings, so midnight never
 * has to stand in for two different meanings.
 * @param {Date | string} value @param {string} [timeZone]
 * @returns {string} YYYY-MM-DD
 */
export function localDate(value, timeZone = 'UTC') {
  if (typeof value === 'string') {
    if (isCalendarDate(value)) return value;
    if (!isRecordDate(value)) throw new RangeError(`not a date: ${JSON.stringify(value)}`);
    value = new Date(value);
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new RangeError(`not a date: ${String(value)}`);
  const { year, month, day } = wallParts(value.getTime(), timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Wall-clock time in a time zone minus UTC, in milliseconds, at an instant. @param {number} time @param {string} timeZone */
function zoneOffset(time, timeZone) {
  const parts = wallParts(time, timeZone);
  const wall = new Date(0);
  wall.setUTCFullYear(parts.year, parts.month - 1, parts.day); // Date.UTC would read years 0-99 as 19xx
  wall.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return wall.getTime() - Math.floor(time / 1000) * 1000;
}

const HOUR_MS = 3_600_000;
// Every UTC offset in use lies between -12:00 and +14:00, so the start of a
// local day is within this window around its "as if UTC" midnight.
const EARLIEST_OFFSET = -12 * HOUR_MS;
const LATEST_OFFSET = 14 * HOUR_MS;

/**
 * The earliest instant whose local date in `timeZone` is `date`, in milliseconds.
 * - Usually local midnight.
 * - When clocks go back over midnight, 00:00 happens twice: the first one.
 * - When clocks jump over midnight, the first instant the day has.
 * - When the whole local day was skipped (Pacific/Apia, 2011-12-30), a
 *   RangeError: the day does not exist there.
 * @param {string} date YYYY-MM-DD @param {string} [timeZone]
 */
export function startOfDay(date, timeZone = 'UTC') {
  if (!isCalendarDate(date)) throw new RangeError(`not a date: ${JSON.stringify(date)}`);
  const midnight = dayNumber(date) * DAY_MS; // local 00:00 written as if it were UTC
  const local = (/** @type {number} */ time) => localDate(new Date(time), timeZone);

  // Every offset in force around that day; each one that maps 00:00 back to
  // itself is a real local midnight. Two of them mean clocks went back over it.
  const offsets = new Set();
  for (let hours = -36; hours <= 36; hours += 6) offsets.add(zoneOffset(midnight + hours * HOUR_MS, timeZone));
  const midnights = [...offsets].map((offset) => midnight - offset).filter((time) => time + zoneOffset(time, timeZone) === midnight);
  if (midnights.length > 0) return Math.min(...midnights);

  // No local midnight: search for the first second whose local date is not
  // before the requested day, between an instant surely still the day before
  // and one surely already that day or later.
  let before = midnight - LATEST_OFFSET - HOUR_MS;
  let after = midnight - EARLIEST_OFFSET + HOUR_MS;
  while (after - before > 1000) {
    const middle = before + Math.floor((after - before) / 2000) * 1000;
    if (local(middle) < date) before = middle;
    else after = middle;
  }
  if (local(after) !== date) throw new RangeError(`${date} does not exist in ${timeZone}: the clocks skipped that day`);
  return after;
}

/**
 * RFC 3339 time in UTC without fractions, as protocol activities use.
 * A calendar date means that whole local day, so its instant is the start of
 * the day in `timeZone`.
 * @param {Date | string} value @param {string} [timeZone]
 */
export function dateTime(value, timeZone = 'UTC') {
  if (!(value instanceof Date) && !isRecordDate(value)) throw new RangeError(`not a date: ${String(value)}`);
  const time = typeof value === 'string' && isCalendarDate(value) ? startOfDay(value, timeZone) : new Date(value).getTime();
  if (!Number.isFinite(time)) throw new RangeError(`not a date: ${String(value)}`);
  return new Date(Math.floor(time / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

/** Days since 1970-01-01 for a calendar date. @param {string} date */
export function dayNumber(date) {
  if (!isCalendarDate(date)) throw new RangeError(`not a date: ${date}`);
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

/** @param {number} days */
function fromDayNumber(days) {
  return new Date(days * DAY_MS).toISOString().slice(0, 10);
}

/** @param {string} date @param {number} days */
export function addDays(date, days) {
  return fromDayNumber(dayNumber(date) + days);
}

/**
 * ISO 8601 week of a calendar date, e.g. "2026-W41".
 * @param {string} date
 */
export function isoWeek(date) {
  const days = dayNumber(date);
  const weekday = (((days + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday; Monday = 0
  const thursday = days - weekday + 3;
  const year = new Date(thursday * DAY_MS).getUTCFullYear();
  const firstThursday = dayNumber(`${year}-01-04`) - ((((dayNumber(`${year}-01-04`) + 3) % 7) + 7) % 7) + 3;
  const week = 1 + Math.round((thursday - firstThursday) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * A running number for ISO weeks, so that consecutive weeks differ by 1.
 * Returns null for anything that is not a real ISO week.
 * @param {unknown} week
 */
export function weekNumber(week) {
  if (typeof week !== 'string') return null;
  const match = WEEK.exec(week);
  if (!match) return null;
  const year = Number(match[1]);
  const index = Number(match[2]);
  const jan4 = dayNumber(`${year}-01-04`);
  const mondayOfWeek1 = jan4 - ((((jan4 + 3) % 7) + 7) % 7);
  const monday = mondayOfWeek1 + (index - 1) * 7;
  if (index < 1 || isoWeek(fromDayNumber(monday)) !== week) return null;
  return Math.floor((monday + 3) / 7);
}
