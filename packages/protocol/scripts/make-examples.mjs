// Regenerates the signing test vector and prints the signed examples used in
// docs/protocol-v0.md. The key is a public test key (32 bytes of 0x11):
// never use it for a real island.
//
//   node packages/protocol/scripts/make-examples.mjs          print only
//   node packages/protocol/scripts/make-examples.mjs --write  also rewrite fixtures/vectors/signing.json

import { writeFileSync } from 'node:fs';

import { encode } from '../src/base64url.js';
import { canonicalize } from '../src/canonicalize.js';
import { importPrivateSeed, publicKeyOf } from '../src/ed25519.js';
import { signActivity } from '../src/sign.js';

const SEED = '11'.repeat(32);
const ORIGIN = 'https://example.org';
const KEY_ID = `${ORIGIN}#k1`;

export const POST = {
  id: 'https://example.org/notes/pointcloud-01',
  type: 'post',
  actor: ORIGIN,
  published: '2026-10-13T12:00:00Z',
  updated: '2026-10-13T12:00:00Z',
  to: 'public',
  object: {
    url: 'https://example.org/notes/pointcloud-01',
    kind: 'article',
    title: '用小模型把点云变成构件',
    summary: '第一次实验的记录：数据、流程和失败的地方。',
    language: 'zh-CN',
    tags: ['点云', 'BIM'],
  },
};

export const MESSAGE = {
  id: 'https://example.org/island/a/01JA0Z8X3K9V',
  type: 'message',
  actor: ORIGIN,
  published: '2026-10-13T12:05:00Z',
  to: ['https://neighbor.example'],
  object: {
    text: '看了你那篇桥的照片，想问一下是在哪拍的？',
    inReplyTo: 'https://neighbor.example/notes/old-bridge',
    public: true,
  },
};

const hex = (/** @type {string} */ text) => Uint8Array.from((text.match(/../g) ?? []).map((byte) => parseInt(byte, 16)));

const privateKey = await importPrivateSeed(hex(SEED));
const publicKey = encode(await publicKeyOf(privateKey));
const signedPost = await signActivity(POST, { keyId: KEY_ID, privateKey });
const signedMessage = await signActivity(MESSAGE, { keyId: KEY_ID, privateKey });

const vector = {
  description: 'Signing vector for islands/0. Public test key (32 bytes of 0x11); never use it for a real island.',
  seed: SEED,
  keyId: KEY_ID,
  publicKey,
  unsigned: POST,
  canonical: canonicalize(POST),
  signature: signedPost.proof.value,
};

if (process.argv.includes('--write')) {
  const target = new URL('../fixtures/vectors/signing.json', import.meta.url);
  writeFileSync(target, `${JSON.stringify(vector, null, 2)}\n`);
  console.log(`wrote ${target.pathname}`);
}

console.log(JSON.stringify({ publicKey, post: signedPost.proof.value, message: signedMessage.proof.value }, null, 2));
