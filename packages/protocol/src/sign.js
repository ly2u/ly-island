// Signing and verifying activities (protocol section "签名").
//
// The signed bytes are the RFC 8785 canonical form of the activity without
// its `proof` member. Unknown members are covered by the signature too, so
// later protocol versions can add fields without breaking old signatures.

import { decode, encode } from './base64url.js';
import { canonicalBytes } from './canonicalize.js';
import { sign, verify } from './ed25519.js';

/**
 * @param {Record<string, unknown>} activity
 * @returns {Uint8Array}
 */
export function signingPayload(activity) {
  const { proof: _proof, ...unsigned } = activity;
  return canonicalBytes(unsigned);
}

/**
 * Returns a copy of `activity` with a `proof`.
 * @param {Record<string, unknown>} activity an activity without `proof`
 * @param {{ keyId: string, privateKey: CryptoKey }} signer
 */
export async function signActivity(activity, { keyId, privateKey }) {
  if (Object.hasOwn(activity, 'proof')) throw new TypeError('activity is already signed');
  const signature = await sign(privateKey, signingPayload(activity));
  return { ...activity, proof: { key: keyId, value: encode(signature) } };
}

/**
 * Checks only the signature bytes. Which key may sign is decided by the key
 * history (keyhistory.js), not here.
 * @param {Record<string, any>} activity
 * @param {Uint8Array | CryptoKey} publicKey
 */
export async function verifySignature(activity, publicKey) {
  const value = activity?.proof?.value;
  if (typeof value !== 'string') return false;
  let signature;
  try {
    signature = decode(value);
  } catch {
    return false;
  }
  let payload;
  try {
    payload = signingPayload(activity);
  } catch {
    return false;
  }
  return verify(publicKey, signature, payload);
}
