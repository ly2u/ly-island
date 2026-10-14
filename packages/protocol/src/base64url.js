// Base64url without padding (RFC 4648 section 5).
// Decoding is strict: the text must be the canonical encoding of its bytes,
// so one signature or key has exactly one accepted spelling.

const ALPHABET = /^[A-Za-z0-9_-]*$/;

/** @param {Uint8Array} bytes */
export function encode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {string} text
 * @returns {Uint8Array}
 */
export function decode(text) {
  if (typeof text !== 'string' || !ALPHABET.test(text) || text.length % 4 === 1) {
    throw new TypeError('invalid base64url');
  }
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (encode(bytes) !== text) throw new TypeError('non-canonical base64url');
  return bytes;
}

/**
 * True when `text` is canonical base64url for exactly `length` bytes.
 * @param {unknown} text
 * @param {number} length
 */
export function isBase64urlOfLength(text, length) {
  if (typeof text !== 'string') return false;
  try {
    return decode(text).length === length;
  } catch {
    return false;
  }
}
