// The island's public protocol documents, built and signed at build time:
// the manifest, the outbox (in pages) and the friends list.

import {
  effectiveUpdated,
  PROTOCOL,
  signActivity,
  validateFriends,
  validateManifest,
  validateOutbox,
} from '../../protocol/src/index.js';
import { dateTime } from './dates.js';
import { rulesFor } from './growth/index.js';
import { recordStats } from './stats.js';

export const OUTBOX_PAGE_SIZE = 50;

export class DocumentError extends Error {}

/** @param {import('./records.js').IslandRecord} record */
function postObject(record) {
  return {
    url: record.url,
    kind: record.kind,
    ...(record.title !== undefined ? { title: record.title } : {}),
    ...(record.summary !== undefined ? { summary: record.summary } : {}),
    language: record.language,
    ...(record.tags.length > 0 ? { tags: record.tags } : {}),
  };
}

/** @param {string} a @param {string} b */
const later = (a, b) => (a > b ? a : b);

/**
 * The newest time among records (published, updated, done, withdrawn), as RFC 3339.
 * @param {import('./records.js').IslandRecord[]} records
 */
export function newestRecordTime(records) {
  let newest = '1970-01-01T00:00:00Z';
  for (const record of records) {
    newest = later(newest, record.updated ?? record.published);
    if (record.done) newest = later(newest, dateTime(record.done));
    if (record.withdrawn) newest = later(newest, dateTime(record.withdrawn));
  }
  return newest;
}

/**
 * Splits activities into pages. Pages are filled from the oldest activity, so
 * a full page never changes again when new records arrive; the newest page,
 * which may hold fewer items, is outbox.json.
 * @param {Record<string, any>[]} activities
 * @param {string} origin @param {string} fallbackUpdated
 */
export function outboxPages(activities, origin, fallbackUpdated) {
  const ordered = [...activities].sort((a, b) =>
    a.published === b.published ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.published < b.published ? -1 : 1,
  );
  const chunks = [];
  for (let i = 0; i < ordered.length; i += OUTBOX_PAGE_SIZE) chunks.push(ordered.slice(i, i + OUTBOX_PAGE_SIZE));
  if (chunks.length === 0) chunks.push([]);
  const nameOf = (/** @type {number} */ index) => (index === chunks.length - 1 ? 'outbox' : `outbox-${index + 1}`);
  return chunks.map((chunk, index) => {
    const name = nameOf(index);
    const items = [...chunk].reverse();
    const updated = items.reduce((max, item) => later(max, effectiveUpdated(item)), '');
    return {
      name,
      path: `/island/${name}.json`,
      document: {
        protocol: PROTOCOL,
        id: `${origin}/island/${name}.json`,
        owner: origin,
        updated: updated || fallbackUpdated,
        items,
        ...(index > 0 ? { next: `${origin}/island/${nameOf(index - 1)}.json` } : {}),
      },
    };
  });
}

/**
 * Builds and signs everything. Throws DocumentError when a document would not
 * pass the protocol's own validation.
 * @param {object} input
 * @param {import('./config.js').IslandConfig} input.config
 * @param {import('./records.js').IslandRecord[]} input.records all records, including withdrawn ones
 * @param {{ id: string, name?: string, since?: string, feed?: string }[]} input.friends
 * @param {import('./growth/default.js').UnlockLedger} input.ledger
 * @param {{ keyId: string, privateKey: CryptoKey, publicKey: string }} input.signer
 * @param {string} input.sourceDate RFC 3339: when the island's sources last changed
 */
export async function buildIsland({ config, records, friends, ledger, signer, sourceDate }) {
  const { origin } = config;
  const updated = later(sourceDate, newestRecordTime(records));
  const stats = recordStats(records);
  const rules = rulesFor(config.growth.rules);
  const facts = records.map((record) => ({
    kind: record.kind,
    date: record.date,
    ...(record.done ? { done: record.done } : {}),
    ...(record.withdrawn ? { withdrawn: record.withdrawn } : {}),
  }));
  const growth = rules.accumulate({ records: facts, ledger }, config.growth.config);

  const signing = { keyId: signer.keyId, privateKey: signer.privateKey };
  const activities = [];
  for (const record of records) {
    if (record.withdrawn) {
      activities.push(
        await signActivity(
          {
            id: `${record.url}#withdrawn`,
            type: 'delete',
            actor: origin,
            published: later(dateTime(record.withdrawn), record.updated ?? record.published),
            to: 'public',
            object: { of: record.url },
          },
          signing,
        ),
      );
    } else {
      activities.push(
        await signActivity(
          {
            id: record.url,
            type: 'post',
            actor: origin,
            published: record.published,
            ...(record.updated ? { updated: record.updated } : {}),
            to: 'public',
            object: postObject(record),
          },
          signing,
        ),
      );
    }
  }
  const pages = outboxPages(activities, origin, updated);

  const manifest = {
    protocol: PROTOCOL,
    id: origin,
    name: config.name,
    ...(config.summary ? { summary: config.summary } : {}),
    language: config.language,
    keys: [{ id: signer.keyId, type: 'Ed25519', publicKey: signer.publicKey }],
    links: {
      home: `${origin}/`,
      outbox: `${origin}/island/outbox.json`,
      friends: `${origin}/island/friends.json`,
      feed: `${origin}/feed.xml`,
    },
    appearance: config.appearance,
    stats: {
      ...stats,
      growth: { rules: rules.id, points: growth.points, stage: growth.stage, unlocked: growth.unlocked },
    },
    discoverable: config.discoverable,
    ai: config.ai,
    updated,
  };

  const friendsDocument = {
    protocol: PROTOCOL,
    id: `${origin}/island/friends.json`,
    owner: origin,
    updated,
    items: friends,
  };

  const problems = [];
  const manifestCheck = validateManifest(manifest, { fetchedOrigin: origin });
  if (!manifestCheck.ok) problems.push(`manifest: ${JSON.stringify(manifestCheck.issues)}`);
  for (const page of pages) {
    const check = validateOutbox(page.document);
    if (!check.valid) problems.push(`${page.path}: ${JSON.stringify([check.issues, check.items.filter((item) => !item.ok)])}`);
  }
  const friendsCheck = validateFriends(friendsDocument);
  if (!friendsCheck.ok) problems.push(`friends (island/friends.json): ${JSON.stringify(friendsCheck.issues)}`);
  if (problems.length > 0) throw new DocumentError(`protocol documents are invalid:\n- ${problems.join('\n- ')}`);

  return { manifest, outbox: pages, friends: friendsDocument, growth, stats };
}
