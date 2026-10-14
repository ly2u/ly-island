import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateFriends, validateKeyLog, validateManifest, validateOutbox } from '../src/documents.js';
import { ZERO_SIGNATURE, unsignedPost } from './helpers.js';

const A = 'https://example.org';
const PUBLIC_KEY = 'A'.repeat(43);

const MANIFEST = {
  protocol: 'islands/0',
  id: A,
  name: '小林的岛',
  summary: '桥梁、点云和一些日常。',
  language: ['zh-CN', 'en'],
  icon: `${A}/icon.png`,
  keys: [{ id: `${A}#k1`, type: 'Ed25519', publicKey: PUBLIC_KEY }],
  links: {
    home: `${A}/`,
    outbox: `${A}/island/outbox.json`,
    friends: `${A}/island/friends.json`,
    feed: `${A}/feed.xml`,
    inbox: `${A}/island/inbox`,
    compose: `${A}/island/compose`,
    keys: `${A}/island/keys.json`,
  },
  accepts: { message: 'friends', visit: 'signed' },
  appearance: { seed: 'k7q2', colors: ['#6fa8dc'] },
  stats: {
    records: { article: 12, note: 40 },
    bottles: 5,
    firstRecord: '2026-03-02',
    lastRecord: '2026-10-13',
    activeWeeks: ['2026-W41', '2026-W42'],
    growth: { rules: 'default@0', points: 87, stage: 'growing', unlocked: ['lighthouse-small'] },
  },
  discoverable: true,
  ai: { read: true, train: false },
  updated: '2026-10-13T12:00:00Z',
};

/** @param {unknown} value @param {Parameters<typeof validateManifest>[1]} [context] */
function manifestCodes(value, context) {
  return validateManifest(value, context).issues.map((issue) => issue.code);
}

describe('validateManifest', () => {
  it('accepts the documented shape and checks the origin it came from', () => {
    assert.deepEqual(manifestCodes(MANIFEST, { fetchedOrigin: A }), []);
    assert.deepEqual(manifestCodes(MANIFEST, { fetchedOrigin: 'https://evil.example' }), ['id-mismatch']);
  });

  it('refuses links on another origin, including the inbox', () => {
    for (const name of ['inbox', 'outbox', 'compose', 'keys', 'friends', 'feed', 'home']) {
      const links = { ...MANIFEST.links, [name]: `https://evil.example/${name}` };
      assert.deepEqual(manifestCodes({ ...MANIFEST, links }), ['cross-origin-link'], name);
    }
    assert.deepEqual(manifestCodes({ ...MANIFEST, icon: 'https://cdn.example/icon.png' }), ['cross-origin-link']);
  });

  it('refuses links that are not plain https', () => {
    assert.deepEqual(manifestCodes({ ...MANIFEST, links: { ...MANIFEST.links, inbox: 'http://example.org/inbox' } }), ['invalid-link']);
    assert.deepEqual(
      manifestCodes({ ...MANIFEST, links: { ...MANIFEST.links, inbox: 'https://user:pw@example.org/inbox' } }),
      ['invalid-link'],
    );
    assert.deepEqual(manifestCodes({ ...MANIFEST, links: { ...MANIFEST.links, inbox: 'https://example.org:8443/inbox' } }), [
      'invalid-link',
    ]);
  });

  it('requires an outbox and at least one well-formed key', () => {
    const { outbox: _outbox, ...links } = MANIFEST.links;
    assert.deepEqual(manifestCodes({ ...MANIFEST, links }), ['missing-outbox']);
    assert.deepEqual(manifestCodes({ ...MANIFEST, keys: [] }), ['invalid-keys']);
    assert.deepEqual(manifestCodes({ ...MANIFEST, keys: [{ id: 'https://evil.example#k1', type: 'Ed25519', publicKey: PUBLIC_KEY }] }), [
      'invalid-key',
    ]);
    assert.deepEqual(
      manifestCodes({ ...MANIFEST, keys: [MANIFEST.keys[0], { ...MANIFEST.keys[0], id: `${A}#k2` }] }),
      ['duplicate-key'],
    );
  });

  it('checks the remaining fields', () => {
    assert.deepEqual(manifestCodes({ ...MANIFEST, protocol: 'islands/1' }), ['unsupported-protocol']);
    assert.deepEqual(manifestCodes({ ...MANIFEST, id: 'https://example.org/' }), ['invalid-id']);
    assert.deepEqual(manifestCodes({ ...MANIFEST, accepts: { message: 'everyone' } }), ['invalid-accepts']);
    assert.deepEqual(manifestCodes({ ...MANIFEST, alsoKnownAs: [A] }), ['invalid-alias']);
    assert.deepEqual(manifestCodes({ ...MANIFEST, stats: { activeWeeks: ['2026-42'] } }), ['invalid-stats']);
    assert.deepEqual(manifestCodes({ ...MANIFEST, appearance: { colors: ['red'] } }), ['invalid-appearance']);
  });
});

describe('validateOutbox', () => {
  const item = { ...unsignedPost(A), proof: { key: `${A}#k1`, value: ZERO_SIGNATURE } };
  const outbox = {
    protocol: 'islands/0',
    id: `${A}/island/outbox.json`,
    owner: A,
    updated: '2026-10-13T12:00:00Z',
    items: [item],
    next: `${A}/island/outbox-2026.json`,
  };

  it('accepts a valid page', () => {
    const result = validateOutbox(outbox);
    assert.equal(result.valid, true);
  });

  it('judges items one by one so readers can skip bad ones', () => {
    const foreign = { ...item, actor: 'https://evil.example', id: 'https://evil.example/x', proof: { key: 'https://evil.example#k1', value: ZERO_SIGNATURE } };
    const directed = { ...item, id: `${A}/island/a/2`, type: 'message', to: ['https://neighbor.example'], object: { text: 'hi' } };
    const result = validateOutbox({ ...outbox, items: [item, foreign, directed] });
    assert.equal(result.ok, true);
    assert.equal(result.valid, false);
    assert.deepEqual(result.items.map((entry) => entry.ok), [true, false, false]);
    assert.ok(result.items[1].issues.some((issue) => issue.code === 'foreign-item'));
    assert.ok(result.items[2].issues.some((issue) => issue.code === 'directed-in-outbox'));
  });

  it('keeps the next page on the same origin', () => {
    const result = validateOutbox({ ...outbox, next: 'https://evil.example/page2.json' });
    assert.deepEqual(result.issues.map((issue) => issue.code), ['cross-origin-link']);
  });

  it('limits a page to 50 items', () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ ...item, id: `${A}/notes/${i}` }));
    assert.equal(validateOutbox({ ...outbox, items }).ok, false);
  });
});

describe('validateFriends', () => {
  const friends = {
    protocol: 'islands/0',
    id: `${A}/island/friends.json`,
    owner: A,
    updated: '2026-10-13T12:00:00Z',
    items: [
      { id: 'https://neighbor.example', name: '邻居的岛', since: '2026-09-01' },
      { id: 'https://blog.example', name: '一个普通博客', feed: 'https://blog.example/atom.xml' },
    ],
  };

  it('accepts islands and plain blogs with feeds on any origin', () => {
    assert.equal(validateFriends(friends).ok, true);
    const elsewhere = { ...friends, items: [{ id: 'https://blog.example', feed: 'https://feeds.example/blog.xml' }] };
    assert.equal(validateFriends(elsewhere).ok, true);
  });

  it('refuses duplicates, the owner itself and malformed entries', () => {
    const codes = (/** @type {unknown[]} */ items) => validateFriends({ ...friends, items }).issues.map((issue) => issue.code);
    assert.deepEqual(codes([friends.items[0], friends.items[0]]), ['duplicate-friend']);
    assert.deepEqual(codes([{ id: A }]), ['invalid-friend']);
    assert.deepEqual(codes([{ id: 'https://neighbor.example', since: '2026-13-01' }]), ['invalid-time']);
  });
});

describe('validateKeyLog', () => {
  const entry = (/** @type {string} */ id, /** @type {string} */ published) => ({
    id: `${A}/island/keys/${id}`,
    type: 'key',
    actor: A,
    published,
    to: 'public',
    object: { add: { id: `${A}#${id}`, type: 'Ed25519', publicKey: PUBLIC_KEY } },
    proof: { key: `${A}#k1`, value: ZERO_SIGNATURE },
  });
  const log = { protocol: 'islands/0', id: `${A}/island/keys.json`, owner: A, updated: '2026-10-13T12:00:00Z', items: [] };

  it('accepts key activities oldest first', () => {
    assert.equal(validateKeyLog({ ...log, items: [entry('k2', '2026-01-01T00:00:00Z'), entry('k3', '2026-02-01T00:00:00Z')] }).ok, true);
  });

  it('refuses other types, other authors and wrong order', () => {
    const codes = (/** @type {unknown[]} */ items) => validateKeyLog({ ...log, items }).issues.map((issue) => issue.code);
    assert.ok(codes([entry('k3', '2026-02-01T00:00:00Z'), entry('k2', '2026-01-01T00:00:00Z')]).includes('not-chronological'));
    assert.ok(codes([{ ...unsignedPost(A), proof: { key: `${A}#k1`, value: ZERO_SIGNATURE } }]).includes('not-key-activity'));
  });
});
