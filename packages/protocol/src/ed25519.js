// Ed25519 through the Web Crypto API, so the same code runs in Node.js,
// Cloudflare Workers and browsers. Keys travel as raw bytes:
// a 32-byte seed for the private key and a 32-byte public key.

import { decode } from './base64url.js';

const ALGORITHM = { name: 'Ed25519' };

// PKCS #8 wrapper for an Ed25519 seed (RFC 8410): the DER prefix is fixed.
const PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export const PUBLIC_KEY_LENGTH = 32;
export const SEED_LENGTH = 32;
export const SIGNATURE_LENGTH = 64;

function subtle() {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error('Web Crypto is not available in this runtime');
  return api;
}

/**
 * @param {Uint8Array} seed 32 bytes
 * @returns {Promise<CryptoKey>}
 */
export async function importPrivateSeed(seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== SEED_LENGTH) throw new TypeError('seed must be 32 bytes');
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + SEED_LENGTH);
  pkcs8.set(PKCS8_PREFIX);
  pkcs8.set(seed, PKCS8_PREFIX.length);
  return subtle().importKey('pkcs8', pkcs8, ALGORITHM, true, ['sign']);
}

/**
 * @param {Uint8Array} publicKey 32 bytes
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(publicKey) {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== PUBLIC_KEY_LENGTH) {
    throw new TypeError('public key must be 32 bytes');
  }
  return subtle().importKey('raw', publicKey, ALGORITHM, false, ['verify']);
}

/**
 * @param {CryptoKey} privateKey an extractable Ed25519 private key
 * @returns {Promise<Uint8Array>}
 */
export async function publicKeyOf(privateKey) {
  const jwk = await subtle().exportKey('jwk', privateKey);
  return decode(/** @type {string} */ (jwk.x));
}

/**
 * Creates a new signing key.
 * @returns {Promise<{ seed: Uint8Array, publicKey: Uint8Array }>}
 */
export async function generateSigningKey() {
  const pair = /** @type {CryptoKeyPair} */ (await subtle().generateKey(ALGORITHM, true, ['sign', 'verify']));
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));
  const publicKey = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  return { seed: pkcs8.slice(PKCS8_PREFIX.length), publicKey };
}

/**
 * @param {CryptoKey} privateKey
 * @param {Uint8Array} message
 * @returns {Promise<Uint8Array>}
 */
export async function sign(privateKey, message) {
  return new Uint8Array(await subtle().sign(ALGORITHM, privateKey, message));
}

/**
 * Never throws for malformed input: anything that is not a valid signature is `false`.
 * @param {Uint8Array | CryptoKey} publicKey
 * @param {Uint8Array} signature
 * @param {Uint8Array} message
 */
export async function verify(publicKey, signature, message) {
  if (!(signature instanceof Uint8Array) || signature.length !== SIGNATURE_LENGTH) return false;
  try {
    const key = publicKey instanceof Uint8Array ? await importPublicKey(publicKey) : publicKey;
    return await subtle().verify(ALGORITHM, key, signature, message);
  } catch {
    return false;
  }
}
