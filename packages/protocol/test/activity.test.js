import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateActivity } from '../src/activity.js';
import { ZERO_SIGNATURE } from './helpers.js';

const A = 'https://example.org';
const B = 'https://neighbor.example';

/** @param {Record<string, any>} fields */
function activity(fields) {
  return {
    id: `${A}/island/a/1`,
    actor: A,
    published: '2026-10-13T12:00:00Z',
    proof: { key: `${A}#k1`, value: ZERO_SIGNATURE },
    ...fields,
  };
}

/** @param {Record<string, any>} value @param {string} key */
function without(value, key) {
  const { [key]: _removed, ...rest } = value;
  return rest;
}

/** @param {unknown} value */
function codes(value) {
  return validateActivity(value).issues.map((issue) => issue.code);
}

const VALID = {
  post: activity({
    type: 'post',
    to: 'public',
    object: { url: `${A}/notes/a`, kind: 'article', title: '标题', summary: '摘要', language: 'zh-CN', tags: ['a'] },
  }),
  delete: activity({ type: 'delete', to: 'public', object: { of: `${A}/notes/a` } }),
  bottle: activity({ type: 'bottle', to: 'public', object: { text: '你好', expires: '2026-11-12T12:00:00Z' } }),
  follow: activity({ type: 'follow', to: [B], object: {} }),
  visit: activity({ type: 'visit', to: [B], object: {} }),
  message: activity({ type: 'message', to: [B], object: { text: '你好', inReplyTo: `${B}/notes/x`, public: true } }),
  water: activity({ type: 'water', to: [B], object: { target: `${B}/notes/x` } }),
  pickup: activity({ type: 'pickup', to: [B], object: { of: `${B}/island/a/9`, text: '捡到了' } }),
  move: activity({ type: 'move', to: 'public', object: { to: 'https://new.example' } }),
  key: activity({
    type: 'key',
    to: 'public',
    object: { add: { id: `${A}#k2`, type: 'Ed25519', publicKey: 'A'.repeat(43) }, revoke: `${A}#k1`, reason: 'retired' },
  }),
};

describe('validateActivity', () => {
  it('accepts every known type in its documented shape', () => {
    for (const [type, value] of Object.entries(VALID)) {
      const result = validateActivity(value);
      assert.deepEqual(result.issues, [], type);
      assert.equal(result.known, true);
    }
    assert.equal(validateActivity(VALID.message).directed, true);
    assert.equal(validateActivity(VALID.post).directed, false);
  });

  it('accepts an unknown type with a valid envelope, marked as unknown', () => {
    const result = validateActivity(activity({ type: 'hug', to: [B], object: { strength: 3 } }));
    assert.equal(result.ok, true);
    assert.equal(result.known, false);
  });

  it('ignores unknown fields', () => {
    assert.deepEqual(codes({ ...VALID.post, future: { anything: true } }), []);
  });

  it('treats updated as optional and never earlier than published', () => {
    assert.deepEqual(codes(VALID.message), []);
    assert.deepEqual(codes({ ...VALID.post, updated: '2026-10-13T11:59:59Z' }), ['updated-before-published']);
  });

  it('requires the id on the actor origin', () => {
    assert.deepEqual(codes({ ...VALID.post, id: `${B}/notes/a` }), ['id-not-on-actor-origin']);
  });

  it('requires canonical origins for actor and recipients', () => {
    assert.ok(codes({ ...VALID.post, actor: 'https://example.org/' }).includes('invalid-actor'));
    assert.ok(codes({ ...VALID.post, actor: 'http://example.org' }).includes('invalid-actor'));
    assert.deepEqual(codes({ ...VALID.message, to: ['https://Neighbor.example'] }), ['invalid-recipient']);
    assert.deepEqual(codes({ ...VALID.message, to: [B, B] }), ['duplicate-recipient']);
    assert.deepEqual(codes({ ...VALID.message, to: [] }), ['invalid-recipients']);
  });

  it('checks the addressing of directed and public types', () => {
    assert.deepEqual(codes({ ...VALID.message, to: 'public' }), ['directed-needs-recipients']);
    assert.deepEqual(codes({ ...VALID.post, to: [B] }), ['public-type-needs-public']);
  });

  it('requires dates with a time zone and real calendar days', () => {
    for (const published of ['2026-10-13 12:00:00Z', '2026-10-13T12:00:00', '2026-02-30T00:00:00Z', '2026-10-13T24:00:00Z']) {
      assert.deepEqual(codes({ ...VALID.post, published }), ['invalid-time'], published);
    }
    assert.deepEqual(codes({ ...without(VALID.post, 'updated'), published: '2026-10-13T20:00:00+08:00' }), []);
  });

  it('checks the proof shape', () => {
    assert.deepEqual(codes({ ...VALID.post, proof: { key: `${B}#k1`, value: ZERO_SIGNATURE } }), ['invalid-key-id']);
    assert.deepEqual(codes({ ...VALID.post, proof: { key: `${A}#k1`, value: 'AAAA' } }), ['invalid-signature-encoding']);
    assert.deepEqual(codes(without(VALID.post, 'proof')), ['invalid-proof']);
  });

  it('enforces text limits in characters, not bytes', () => {
    const post = (/** @type {string} */ title) => ({ ...VALID.post, object: { ...VALID.post.object, title } });
    assert.deepEqual(codes(post('桥'.repeat(200))), []);
    assert.deepEqual(codes(post('桥'.repeat(201))), ['invalid-title']);
    const bottle = (/** @type {string} */ text) => ({ ...VALID.bottle, object: { text } });
    assert.deepEqual(codes(bottle('😀'.repeat(500))), []);
    assert.deepEqual(codes(bottle('a'.repeat(501))), ['invalid-text']);
    assert.deepEqual(codes({ ...VALID.message, object: { text: '' } }), ['invalid-text']);
  });

  it('keeps links in posts and bottles on the actor origin', () => {
    assert.deepEqual(codes({ ...VALID.post, object: { ...VALID.post.object, url: `${B}/x` } }), ['url-not-on-actor-origin']);
    assert.deepEqual(codes({ ...VALID.bottle, object: { text: 'x', url: `${B}/x` } }), ['url-not-on-actor-origin']);
  });

  it('sends a pickup only to the island that threw the bottle', () => {
    assert.deepEqual(codes({ ...VALID.pickup, object: { of: 'https://third.example/island/a/1' } }), ['pickup-not-to-author']);
    assert.deepEqual(codes({ ...VALID.pickup, to: [B, 'https://third.example'] }), ['pickup-needs-one-recipient']);
  });

  it('checks key changes', () => {
    const key = (/** @type {Record<string, any>} */ object, /** @type {Record<string, any>} */ extra = {}) => ({ ...VALID.key, object, ...extra });
    assert.deepEqual(codes(key({})), ['empty-key-change']);
    assert.deepEqual(codes(key({ add: { id: `${B}#k2`, type: 'Ed25519', publicKey: 'A'.repeat(43) } })), ['invalid-key']);
    assert.deepEqual(codes(key({ revoke: `${A}#k1`, reason: 'lost' })), ['invalid-reason']);
    assert.deepEqual(codes(key({ add: VALID.key.object.add, reason: 'retired' })), ['reason-without-revoke']);
    assert.deepEqual(
      codes(key({ add: VALID.key.object.add }, { proof: { key: `${A}#k2`, value: ZERO_SIGNATURE } })),
      ['self-signed-key'],
    );
  });

  it('refuses moves to itself and oversized activities', () => {
    assert.deepEqual(codes({ ...VALID.move, object: { to: A } }), ['move-to-self']);
    assert.ok(codes({ ...VALID.message, padding: 'x'.repeat(17000) }).includes('too-large'));
  });

  it('never throws on junk', () => {
    for (const value of [null, 1, 'x', [], { type: 1 }, { object: [] }, Object.create(null)]) {
      assert.equal(validateActivity(value).ok, false);
    }
  });
});
