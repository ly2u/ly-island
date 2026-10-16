import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addDays, dateTime, isCalendarDate, isRecordDate, isoWeek, localDate, weekNumber } from '../src/dates.js';

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
  assert.equal(localDate('2026-10-01', 'America/New_York'), '2026-10-01');
  assert.equal(localDate(new Date('2026-10-01T00:00:00Z'), 'America/New_York'), '2026-09-30');
  assert.equal(localDate('2026-10-05T00:00:00Z', 'America/Los_Angeles'), '2026-10-04');
  assert.equal(isoWeek(localDate('2026-10-05T00:00:00Z', 'America/Los_Angeles')), '2026-W40');
  assert.equal(localDate('2027-01-04T00:00:00Z', 'America/Los_Angeles'), '2027-01-03');
  assert.equal(localDate('2026-10-01T00:30:00+08:00', 'UTC'), '2026-09-30');
  assert.equal(localDate(new Date('2026-09-30T17:00:00Z'), 'Asia/Shanghai'), '2026-10-01');
  assert.equal(localDate(new Date('2026-10-01T03:00:00Z'), 'America/New_York'), '2026-09-30');
  assert.throws(() => localDate('2026-02-30'), RangeError);
  assert.throws(() => localDate(new Date(Number.NaN)), RangeError);
  assert.ok(!isCalendarDate('2026-13-01'));
});

test('raw dates reject coercion, overflow and ambiguous timestamps', () => {
  for (const value of [null, false, 0, [], {}, '2026-02-30', '2025-02-29', '2026-02-30T00:00:00Z',
    '2026-10-01T24:00:00Z', '2026-10-01T00:60:00Z', '2026-10-01T00:00:60Z',
    '2026-10-01T00:00:00+24:00', '2026-10-01T00:00:00', '2026-10-01\n', '10/01/2026']) {
    assert.equal(isRecordDate(value), false, JSON.stringify(value));
    assert.throws(() => dateTime(value), RangeError, JSON.stringify(value));
    assert.throws(() => localDate(value), RangeError, JSON.stringify(value));
  }
  for (const value of ['2024-02-29', '2024-02-29T23:59:59.123Z', '2026-10-01T08:00:00+08:00']) {
    assert.equal(isRecordDate(value), true, value);
  }
});

test('date-times are RFC 3339 in UTC without fractions', () => {
  assert.equal(dateTime('2026-10-01'), '2026-10-01T00:00:00Z');
  assert.equal(dateTime(new Date('2026-10-01T12:34:56.789Z')), '2026-10-01T12:34:56Z');
  assert.equal(dateTime('2026-10-01T08:00:00+08:00'), '2026-10-01T00:00:00Z');
  assert.throws(() => dateTime('soon'), RangeError);
});

test('a calendar day starts at local midnight, or at the first instant a clock change leaves', async () => {
  const { startOfDay } = await import('../src/dates.js');
  const iso = (/** @type {number} */ time) => new Date(time).toISOString();
  assert.equal(iso(startOfDay('2026-10-05', 'Asia/Shanghai')), '2026-10-04T16:00:00.000Z');
  assert.equal(iso(startOfDay('2026-10-05', 'Asia/Kolkata')), '2026-10-04T18:30:00.000Z');
  assert.equal(iso(startOfDay('2026-03-08', 'America/Los_Angeles')), '2026-03-08T08:00:00.000Z');
  assert.equal(iso(startOfDay('2026-11-01', 'America/Los_Angeles')), '2026-11-01T07:00:00.000Z');
  // Cuba moves its clocks at midnight: 2026-03-08 begins at 01:00 local.
  assert.equal(iso(startOfDay('2026-03-08', 'America/Havana')), '2026-03-08T05:00:00.000Z');
  assert.equal(iso(startOfDay('0099-01-01', 'UTC')), '0099-01-01T00:00:00.000Z');
  assert.equal(localDate(new Date('0099-01-01T00:00:00Z'), 'UTC'), '0099-01-01');
  // Amman went back from 01:00 to 00:00 on 2021-10-29: the day starts at the first midnight.
  assert.equal(iso(startOfDay('2021-10-29', 'Asia/Amman')), '2021-10-28T21:00:00.000Z');
  assert.equal(localDate(new Date(Date.parse('2021-10-28T21:00:00Z') - 1000), 'Asia/Amman'), '2021-10-28');
  // Samoa skipped 2011-12-30 entirely: that day does not exist there.
  assert.throws(() => startOfDay('2011-12-30', 'Pacific/Apia'), /2011-12-30 does not exist in Pacific\/Apia/);
  assert.equal(iso(startOfDay('2011-12-31', 'Pacific/Apia')), '2011-12-30T10:00:00.000Z');
  assert.equal(iso(startOfDay('2011-12-29', 'Pacific/Apia')), '2011-12-29T10:00:00.000Z');
  // The result is always the first second of the requested day.
  for (const [day, zone] of [['2021-10-29', 'Asia/Amman'], ['2026-03-08', 'America/Havana'], ['2026-11-01', 'America/Havana'], ['2026-10-05', 'Pacific/Chatham'], ['2026-10-05', 'Etc/GMT+12'], ['2026-10-05', 'Pacific/Kiritimati']]) {
    const start = startOfDay(day, zone);
    assert.equal(localDate(new Date(start), zone), day, `${day} ${zone}`);
    assert.ok(localDate(new Date(start - 1000), zone) < day, `${day} ${zone}: an earlier second is already that day`);
  }
  assert.equal(dateTime('2026-10-05', 'Asia/Shanghai'), '2026-10-04T16:00:00Z');
  assert.equal(dateTime('2026-10-05'), '2026-10-05T00:00:00Z');
});
