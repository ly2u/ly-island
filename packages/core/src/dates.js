// Calendar helpers. Records keep the author's local date: a front matter date
// without a time is that day; a date with a time is converted to the island's
// time zone. Weeks are ISO 8601 weeks (Monday first).

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK = /^(\d{4})-W(\d{2})$/;

/** @param {string} value */
export function isCalendarDate(value) {
  const match = DATE.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
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
 * - a string with a time keeps the date as written (the author's own clock);
 * - a Date at exactly 00:00:00.000 UTC is a date without a time (that is how
 *   YAML parses `date: 2026-10-01`), so it is that UTC day;
 * - any other Date is converted to `timeZone`.
 * @param {Date | string} value @param {string} [timeZone]
 * @returns {string} YYYY-MM-DD
 */
export function localDate(value, timeZone = 'UTC') {
  if (typeof value === 'string') {
    const day = value.slice(0, 10);
    if (!isCalendarDate(day) || (value.length > 10 && !Number.isFinite(Date.parse(value)))) {
      throw new RangeError(`not a date: ${JSON.stringify(value)}`);
    }
    return day;
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new RangeError(`not a date: ${String(value)}`);
  if (value.getTime() % DAY_MS === 0) return value.toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(value)
    .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), /** @type {Record<string, string>} */ ({}));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * RFC 3339 time in UTC without fractions, as protocol activities use.
 * A calendar date becomes midnight UTC of that day.
 * @param {Date | string} value
 */
export function dateTime(value) {
  const time = typeof value === 'string' && isCalendarDate(value) ? Date.parse(`${value}T00:00:00Z`) : new Date(value).getTime();
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
