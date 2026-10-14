import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { decode, encode } from '../src/base64url.js';
import { canonicalize } from '../src/canonicalize.js';
import { generateSigningKey, importPrivateSeed, publicKeyOf, sign, verify } from '../src/ed25519.js';
import { signActivity, signingPayload, verifySignature } from '../src/sign.js';
import { fromHex, makeKey, SEEDS, signWith, toHex, unsignedPost } from './helpers.js';

// RFC 8032 section 7.1, TEST 1 and TEST 2.
const RFC8032 = [
  {
    seed: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
    publicKey: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    message: '',
    signature:
      'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
  },
  {
    seed: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
    publicKey: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
    message: '72',
    signature:
      '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
  },
];

describe('Ed25519', () => {
  it('reproduces the RFC 8032 test vectors', async () => {
    for (const vector of RFC8032) {
      const privateKey = await importPrivateSeed(fromHex(vector.seed));
      assert.equal(toHex(await publicKeyOf(privateKey)), vector.publicKey);
      assert.equal(toHex(await sign(privateKey, fromHex(vector.message))), vector.signature);
      assert.equal(await verify(fromHex(vector.publicKey), fromHex(vector.signature), fromHex(vector.message)), true);
    }
  });

  it('rejects malformed signatures and keys without throwing', async () => {
    const [vector] = RFC8032;
    assert.equal(await verify(fromHex(vector.publicKey), new Uint8Array(63), new Uint8Array()), false);
    assert.equal(await verify(new Uint8Array(31), fromHex(vector.signature), new Uint8Array()), false);
  });

  it('generates usable keys', async () => {
    const { seed, publicKey } = await generateSigningKey();
    assert.equal(seed.length, 32);
    const privateKey = await importPrivateSeed(seed);
    assert.deepEqual(await publicKeyOf(privateKey), publicKey);
    const signature = await sign(privateKey, new Uint8Array([1, 2, 3]));
    assert.equal(await verify(publicKey, signature, new Uint8Array([1, 2, 3])), true);
  });
});

describe('activity signatures', () => {
  const origin = 'https://example.org';

  it('signs the canonical form without the proof', async () => {
    const key = await makeKey(origin, 'k1', SEEDS.k1);
    const signed = await signWith(key, unsignedPost(origin));
    assert.equal(signed.proof.key, `${origin}#k1`);
    const { proof, ...rest } = signed;
    assert.deepEqual(signingPayload(signed), new TextEncoder().encode(canonicalize(rest)));
    assert.equal(await verifySignature(signed, decode(key.publicKey)), true);
  });

  it('does not depend on member order', async () => {
    const key = await makeKey(origin, 'k1', SEEDS.k1);
    const signed = await signWith(key, unsignedPost(origin));
    const reordered = Object.fromEntries(Object.entries(signed).reverse());
    assert.equal(await verifySignature(reordered, decode(key.publicKey)), true);
  });

  it('fails when any signed field changes, including unknown ones', async () => {
    const key = await makeKey(origin, 'k1', SEEDS.k1);
    const signed = await signWith(key, { ...unsignedPost(origin), extension: { level: 1 } });
    const publicKey = decode(key.publicKey);
    const tampered = [
      { ...signed, published: '2026-10-13T12:00:01Z' },
      { ...signed, object: { ...signed.object, kind: 'article' } },
      { ...signed, extension: { level: 2 } },
      { ...signed, added: true },
    ];
    for (const activity of tampered) assert.equal(await verifySignature(activity, publicKey), false);
  });

  it('fails with another key or a broken proof', async () => {
    const key = await makeKey(origin, 'k1', SEEDS.k1);
    const other = await makeKey(origin, 'k2', SEEDS.k2);
    const signed = await signWith(key, unsignedPost(origin));
    assert.equal(await verifySignature(signed, decode(other.publicKey)), false);
    assert.equal(await verifySignature({ ...signed, proof: { key: signed.proof.key, value: '###' } }, decode(key.publicKey)), false);
    assert.equal(await verifySignature({ ...signed, proof: undefined }, decode(key.publicKey)), false);
  });

  it('refuses to sign twice', async () => {
    const key = await makeKey(origin, 'k1', SEEDS.k1);
    const signed = await signWith(key, unsignedPost(origin));
    await assert.rejects(() => signActivity(signed, { keyId: key.keyId, privateKey: key.privateKey }));
  });

  it('reproduces the committed signing vector', async () => {
    const vector = JSON.parse(readFileSync(new URL('../fixtures/vectors/signing.json', import.meta.url), 'utf8'));
    const privateKey = await importPrivateSeed(fromHex(vector.seed));
    assert.equal(encode(await publicKeyOf(privateKey)), vector.publicKey);
    assert.equal(canonicalize(vector.unsigned), vector.canonical);
    const signed = await signActivity(vector.unsigned, { keyId: vector.keyId, privateKey });
    assert.equal(signed.proof.value, vector.signature);
  });
});
