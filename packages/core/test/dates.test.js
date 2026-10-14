import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addDays, dateTime, isCalendarDate, isoWeek, localDate, weekNumber } from '../src/dates.js';

test('ISO weeks, including years with 53 weeks', () => {
  for (const [day, week] of [
    ['2026-01-01', '2026-W01'],
    ['2024-12-30', '2025-W01'],
    ['2021-01-03', '2020-W53'],
    ['2020-12-31', '2020-W53'],
    ['2026-10-14', '2026-W42'],
    ['2026-10-18', '2026-W42'],
    ['2026-10-19', '2026-W43'],
    ['2027-01-01', '2026-W53'],
  ]) {
    assert.equal(isoWeek(day), week, day);
  }
});

test('week numbers are consecutive across years and reject weeks that do not exist', () => {
  assert.equal(weekNumber('2027-W01') - weekNumber('2026-W53'), 1);
  assert.equal(weekNumber('2026-W01') - weekNumber('2025-W52'), 1);
  assert.equal(weekNumber('2025-W53'), null);
  assert.equal(weekNumber('2026-W00'), null);
  assert.equal(weekNumber('2026-W1'), null);
  assert.equal(weekNumber(42), null);
  let day = '2025-12-01';
  for (let i = 0; i < 400; i += 1) {
    const next = addDays(day, 7);
    assert.equal(weekNumber(isoWeek(next)) - weekNumber(isoWeek(day)), 1, day);
    day = next;
  }
});

test('local dates: dates stay, times move to the island time zone', () => {
  assert.equal(localDate('2026-10-01'), '2026-10-01');
  assert.equal(localDate('2026-10-01T23:30:00+08:00', 'UTC'), '2026-10-01');
  // YAML turns `date: 2026-10-01` into midnight UTC: that is a date without a time.
  assert.equal(localDate(new Date('2026-10-01T00:00:00Z'), 'America/New_York'), '2026-10-01');
  assert.equal(localDate(new Date('2026-09-30T17:00:00Z'), 'Asia/Shanghai'), '2026-10-01');
  assert.equal(localDate(new Date('2026-10-01T03:00:00Z'), 'America/New_York'), '2026-09-30');
  assert.throws(() => localDate('2026-02-30'), RangeError);
  assert.throws(() => localDate(new Date(Number.NaN)), RangeError);
  assert.ok(!isCalendarDate('2026-13-01'));
});

test('date-times are RFC 3339 in UTC without fractions', () => {
  assert.equal(dateTime('2026-10-01'), '2026-10-01T00:00:00Z');
  assert.equal(dateTime(new Date('2026-10-01T12:34:56.789Z')), '2026-10-01T12:34:56Z');
  assert.equal(dateTime('2026-10-01T08:00:00+08:00'), '2026-10-01T00:00:00Z');
  assert.throws(() => dateTime('soon'), RangeError);
});
