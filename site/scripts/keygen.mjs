// Creates the island's signing key.
//
//   npm run keygen
//
// Prints a new private key (an Ed25519 seed, 64 hex characters) and its
// public key. Keep the private key as the ISLAND_SIGNING_KEY build secret
// and in a password manager. Never commit it.

import { webcrypto } from 'node:crypto';

import { encodeBase64url, importPrivateSeed, publicKeyOf } from '../../packages/protocol/src/index.js';

const seed = webcrypto.getRandomValues(new Uint8Array(32));
const publicKey = encodeBase64url(await publicKeyOf(await importPrivateSeed(seed)));
const hex = Buffer.from(seed).toString('hex');

console.log(`
ISLAND_SIGNING_KEY=${hex}

Public key: ${publicKey}

把上面这一行设成构建密钥（Cloudflare：Worker → Settings → Build → Variables and secrets，类型选 Secret），
再存进密码管理器。不要提交到仓库，也不要发给任何人。丢了它，这座岛就要换钥匙。

Set the line above as a build secret (Cloudflare: Worker, Settings, Build, Variables and secrets,
type Secret) and keep a copy in a password manager. Never commit it or share it.
`);
