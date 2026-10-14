import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { precheckDelivery } from '../src/inbox.js';
import { ZERO_SIGNATURE } from './helpers.js';

const SELF = 'https://neighbor.example';
const A = 'https://example.org';
const NOW = Date.parse('2026-10-13T12:10:00Z');

/** @param {Record<string, any>} fields */
function delivery(fields = {}) {
  return {
    id: `${A}/island/a/1`,
    type: 'message',
    actor: A,
    published: '2026-10-13T12:05:00Z',
    to: [SELF],
    object: { text: '你好' },
    proof: { key: `${A}#k1`, value: ZERO_SIGNATURE },
    ...fields,
  };
}

/** @param {unknown} body @param {Partial<Parameters<typeof precheckDelivery>[1]>} [context] */
function check(body, context = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const result = precheckDelivery(text, { self: SELF, now: NOW, seen: () => false, ...context });
  return result.action === 'verify' ? 'verify' : `${result.status} ${result.reason}`;
}

describe('inbox precheck', () => {
  it('passes a well-formed delivery on to signature verification', () => {
    assert.equal(check(delivery()), 'verify');
  });

  it('answers 202 and drops unknown types, without looking further', () => {
    assert.equal(check(delivery({ type: 'hug', object: { strength: 3 } })), '202 unknown-type');
    // Same answer even when it is not addressed to us: nothing is stored either way.
    assert.equal(check(delivery({ type: 'hug', to: ['https://other.example'] })), '202 unknown-type');
  });

  it('answers 400 for known types that cannot be delivered', () => {
    assert.equal(check(delivery({ type: 'post', to: 'public', object: { url: `${A}/x`, kind: 'note' } })), '400 not-deliverable');
    assert.equal(check(delivery({ type: 'delete', to: 'public', object: { of: `${A}/x` } })), '400 not-deliverable');
  });

  it('answers 400 for a broken envelope, whatever the type', () => {
    assert.equal(check('{not json'), '400 invalid-json');
    assert.equal(check([]), '400 invalid-envelope');
    assert.equal(check(delivery({ id: 'https://evil.example/x' })), '400 invalid-envelope');
    assert.equal(check(delivery({ type: 'hug', proof: { key: `${A}#k1`, value: 'x' } })), '400 invalid-envelope');
    assert.equal(check(delivery({ object: { text: '' } })), '400 invalid-activity');
  });

  it('answers 413 above 16 KB', () => {
    assert.equal(check(delivery({ object: { text: 'x'.repeat(17_000) } })), '413 too-large');
  });

  it('refuses deliveries not addressed to this island', () => {
    assert.equal(check(delivery({ to: ['https://other.example'] })), '400 not-addressed');
  });

  it('enforces the time window', () => {
    assert.equal(check(delivery({ published: '2026-10-11T12:09:59Z' })), '400 too-old');
    assert.equal(check(delivery({ published: '2026-10-11T12:10:00Z' })), 'verify');
    assert.equal(check(delivery({ published: '2026-10-13T12:20:00Z' })), 'verify');
    assert.equal(check(delivery({ published: '2026-10-13T12:20:01Z' })), '400 in-the-future');
  });

  it('answers 202 to a repeat of something already accepted', () => {
    const seen = (/** @type {string} */ actor, /** @type {string} */ id) => actor === A && id === `${A}/island/a/1`;
    assert.equal(check(delivery(), { seen }), '202 duplicate');
    assert.equal(check(delivery({ id: `${A}/island/a/2` }), { seen }), 'verify');
  });

  it('refuses bodies that are not UTF-8', () => {
    const result = precheckDelivery(new Uint8Array([0xff, 0xfe, 0x7b]), { self: SELF, now: NOW, seen: () => false });
    assert.equal(`${result.status} ${result.action === 'verify' ? '' : result.reason}`, '400 invalid-json');
  });
});
