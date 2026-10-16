// Protocol documents for the comparison spike, shared by both generators so
// that only the generator differs. Spike code: not the real build step.
//
// The signing key comes from ISLAND_SEED (64 hex characters). Without it the
// public test key is used (32 bytes of 0x11), which must never sign a real island.

import {
  encodeBase64url,
  importPrivateSeed,
  publicKeyOf,
  signActivity,
} from '../../../packages/protocol/src/index.js';

export const SITE = 'https://example.org';
export const SITE_NAME = '示例岛';
export const SITE_SUMMARY = '静态生成器对比用的示例岛屿。';

const TEST_SEED = '11'.repeat(32);

/** @param {string} hex */
function fromHex(hex) {
  return Uint8Array.from((hex.match(/../g) ?? []).map((byte) => parseInt(byte, 16)));
}

/**
 * @typedef {{ slug: string, title: string, date: Date, kind: string, summary?: string, tags?: string[] }} Note
 */

/** @param {Date} date */
function isoDate(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

let signerPromise;
function signer() {
  signerPromise ??= (async () => {
    const seed = process.env.ISLAND_SEED ?? TEST_SEED;
    if (!/^[0-9a-f]{64}$/.test(seed)) throw new Error('ISLAND_SEED must be 64 lowercase hex characters');
    const privateKey = await importPrivateSeed(fromHex(seed));
    return { keyId: `${SITE}#k1`, privateKey, publicKey: encodeBase64url(await publicKeyOf(privateKey)) };
  })();
  return signerPromise;
}

/**
 * Builds the manifest, outbox and friends list for the given notes.
 * @param {Note[]} notes
 */
export async function islandDocuments(notes) {
  const key = await signer();
  const sorted = [...notes].sort((a, b) => b.date.getTime() - a.date.getTime());
  const updated = sorted.length > 0 ? isoDate(sorted[0].date) : '2026-10-01T00:00:00Z';

  const items = [];
  for (const note of sorted) {
    const url = `${SITE}/notes/${note.slug}/`;
    const object = { url, kind: note.kind, title: note.title, language: 'zh-CN' };
    if (note.summary) object.summary = note.summary;
    if (note.tags && note.tags.length > 0) object.tags = note.tags;
    items.push(
      await signActivity(
        { id: url, type: 'post', actor: SITE, published: isoDate(note.date), to: 'public', object },
        { keyId: key.keyId, privateKey: key.privateKey },
      ),
    );
  }

  const counts = {};
  for (const note of notes) counts[note.kind] = (counts[note.kind] ?? 0) + 1;

  const manifest = {
    protocol: 'islands/0',
    id: SITE,
    name: SITE_NAME,
    summary: SITE_SUMMARY,
    language: ['zh-CN'],
    keys: [{ id: key.keyId, type: 'Ed25519', publicKey: key.publicKey }],
    links: {
      home: `${SITE}/`,
      outbox: `${SITE}/island/outbox.json`,
      friends: `${SITE}/island/friends.json`,
      feed: `${SITE}/feed.xml`,
    },
    stats: { records: counts },
    updated,
  };

  const outbox = { protocol: 'islands/0', id: `${SITE}/island/outbox.json`, owner: SITE, updated, items };

  const friends = {
    protocol: 'islands/0',
    id: `${SITE}/island/friends.json`,
    owner: SITE,
    updated,
    items: [{ id: 'https://neighbor.example', name: '邻居的岛', since: '2026-09-01' }],
  };

  return { manifest, outbox, friends };
}

/**
 * Inputs for the island picture, the same for both generators.
 * @param {Note[]} notes
 */
export function islandShape(notes) {
  const counts = { article: 0, note: 0, project: 0 };
  for (const note of notes) counts[/** @type {'article'} */ (note.kind)] = (counts[/** @type {'article'} */ (note.kind)] ?? 0) + 1;
  return { trees: counts.note, houses: counts.article, towers: counts.project };
}
