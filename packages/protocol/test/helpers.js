// Shared test helpers. The seeds below are public test keys: never use them
// for a real island.

import { encode } from '../src/base64url.js';
import { importPrivateSeed, publicKeyOf } from '../src/ed25519.js';
import { signActivity } from '../src/sign.js';

export const SEEDS = Object.freeze({
  k1: '11'.repeat(32),
  k2: '22'.repeat(32),
  k3: '33'.repeat(32),
  neighbor: '44'.repeat(32),
  stranger: '55'.repeat(32),
});

/** @param {string} hex */
export function fromHex(hex) {
  return Uint8Array.from((hex.match(/../g) ?? []).map((byte) => parseInt(byte, 16)));
}

/** @param {Uint8Array} bytes */
export function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * A signing key for tests.
 * @param {string} origin
 * @param {string} name key name, e.g. "k1"
 * @param {string} seedHex
 */
export async function makeKey(origin, name, seedHex) {
  const privateKey = await importPrivateSeed(fromHex(seedHex));
  const publicKey = encode(await publicKeyOf(privateKey));
  return { origin, keyId: `${origin}#${name}`, privateKey, publicKey };
}

/**
 * @param {Awaited<ReturnType<typeof makeKey>>} key
 * @param {Record<string, unknown>} activity
 */
export function signWith(key, activity) {
  return signActivity(activity, { keyId: key.keyId, privateKey: key.privateKey });
}

/**
 * A minimal valid manifest.
 * @param {string} origin
 * @param {{ id: string, publicKey: string }[]} keys
 * @param {Record<string, unknown>} [extra]
 */
export function manifestFor(origin, keys, extra = {}) {
  return {
    protocol: 'islands/0',
    id: origin,
    name: 'Test island',
    keys: keys.map((key) => ({ id: key.id ?? /** @type {any} */ (key).keyId, type: 'Ed25519', publicKey: key.publicKey })),
    links: { outbox: `${origin}/island/outbox.json`, inbox: `${origin}/island/inbox`, keys: `${origin}/island/keys.json` },
    updated: '2026-10-14T00:00:00Z',
    ...extra,
  };
}

/** A structurally valid but meaningless signature: 64 zero bytes. */
export const ZERO_SIGNATURE = 'A'.repeat(86);

/**
 * @param {string} actor
 * @param {Record<string, unknown>} fields
 */
export function unsignedPost(actor, fields = {}) {
  return {
    id: `${actor}/notes/a`,
    type: 'post',
    actor,
    published: '2026-10-13T12:00:00Z',
    to: 'public',
    object: { url: `${actor}/notes/a`, kind: 'note' },
    ...fields,
  };
}
