// Islands in one process: each has its own SQLite store, static files built
// by @islands/core, a signing key and the island service; a fake network
// connects them, and also plays Telegram, ntfy, a webhook and Cloudflare
// Access. Every request is counted, so tests can assert budgets.
// The seeds here are public test keys: never for a real island.

import { encodeBase64url } from '../../protocol/src/index.js';
import { buildFeed, buildIsland, islandConfig, islandSigner, normalizeRecords } from '../../core/src/index.js';
import { createIsland } from '../src/index.js';
import { sqliteStore } from '../src/store-node.js';
import { clearAccessCache } from '../src/auth.js';
import { migrate } from '../src/schema.js';

export const TEAM = 'https://islands-test.cloudflareaccess.com';
export const AUD = 'test-audience-tag';

/** A clock tests can move. */
export function clock(start = Date.parse('2026-10-14T04:00:00Z')) {
  let time = start;
  return { now: () => time, advance: (/** @type {number} */ ms) => (time += ms), set: (/** @type {number} */ t) => (time = t) };
}

/** @param {Uint8Array | string} body */
async function etagOf(body) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `"${encodeBase64url(new Uint8Array(digest)).slice(0, 16)}"`;
}

export function network() {
  /** @type {Map<string, (request: Request) => Promise<Response>>} */
  const hosts = new Map();
  /** @type {{ method: string, url: string }[]} */
  const log = [];
  return {
    log,
    hosts,
    /** @param {string} host @param {(request: Request) => Promise<Response> | Response} handler */
    route(host, handler) {
      hosts.set(host, async (request) => handler(request));
    },
    /** @type {typeof fetch} */
    async fetch(input, init) {
      const request = new Request(input, init);
      const url = new URL(request.url);
      log.push({ method: request.method, url: request.url });
      const handler = hosts.get(url.host);
      if (!handler) throw new TypeError(`fetch failed: no route to ${url.host}`);
      return handler(request);
    },
    count(/** @type {(entry: { method: string, url: string }) => boolean} */ filter = () => true) {
      return log.filter(filter).length;
    },
  };
}

/** Telegram, ntfy and webhook endpoints that record what they receive. */
export function channels(net) {
  /** @type {{ channel: string, body: any }[]} */
  const received = [];
  net.route('api.telegram.org', async (request) => {
    received.push({ channel: 'telegram', body: await request.json() });
    return Response.json({ ok: true });
  });
  net.route('ntfy.example', async (request) => {
    received.push({ channel: 'ntfy', body: await request.json() });
    return Response.json({ ok: true });
  });
  net.route('hooks.example', async (request) => {
    received.push({ channel: 'webhook', body: await request.json() });
    return new Response(null, { status: 204 });
  });
  return received;
}

/** A Cloudflare Access team: its certs endpoint, and tokens it (or someone else) signs. */
export async function access(net) {
  const keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  net.route(new URL(TEAM).host, () => Response.json({ keys: [{ kid: 'k-test', kty: 'RSA', alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e }] }));
  clearAccessCache();
  const encode = (/** @type {unknown} */ value) => encodeBase64url(new TextEncoder().encode(JSON.stringify(value)));
  return {
    /** @param {Record<string, unknown>} claims @param {{ header?: Record<string, unknown>, key?: CryptoKey }} [options] */
    async token(claims, { header = {}, key = keyPair.privateKey } = {}) {
      const head = encode({ alg: 'RS256', kid: 'k-test', typ: 'JWT', ...header });
      const body = encode(claims);
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
      return `${head}.${body}.${encodeBase64url(new Uint8Array(signature))}`;
    },
    otherKey: other.privateKey,
    /** Claims of a valid owner login at `now` (ms). @param {number} now */
    claims: (now) => ({ iss: TEAM, aud: [AUD], email: 'owner@example.org', iat: Math.floor(now / 1000), nbf: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600 }),
  };
}

/**
 * @param {object} options
 * @param {ReturnType<typeof network>} options.net
 * @param {ReturnType<typeof clock>} options.time
 * @param {string} options.origin
 * @param {string} options.seed 64 hex characters
 * @param {string} [options.name]
 * @param {number} [options.records] how many example records
 * @param {{ id: string, name?: string }[]} [options.friends]
 * @param {Record<string, string>} [options.accepts]
 * @param {Record<string, any>} [options.notify]
 * @param {Record<string, any>} [options.env]
 * @param {((host: string) => Promise<string[]>) | null} [options.resolver]
 */
export async function island({ net, time, origin, seed, name = new URL(origin).hostname, records = 2, friends = [], accepts = {}, notify = {}, env = {}, resolver = null }) {
  const store = sqliteStore();
  await migrate(store);
  /** @type {Map<string, { body: string, type: string }>} */
  const files = new Map();
  let recordInputs = Array.from({ length: records }, (_, i) => ({
    slug: `r${i + 1}`,
    kind: 'article',
    title: `${name} 记录 ${i + 1}`,
    date: new Date(Date.parse('2026-01-01T00:00:00Z') + i * 86_400_000),
    html: '<p>正文</p>',
  }));

  async function publish() {
    const config = islandConfig({ origin, name, language: ['zh-CN'], timeZone: 'Asia/Shanghai', interactions: { accepts } });
    const list = normalizeRecords(recordInputs, { origin, timeZone: 'Asia/Shanghai', language: 'zh-CN' });
    const signer = await islandSigner({ ISLAND_SIGNING_KEY: seed }, { origin, keyName: 'k1' });
    const built = await buildIsland({ config, records: list, friends, ledger: { unlocked: [] }, signer, sourceDate: '2026-10-01T00:00:00Z' });
    files.clear();
    files.set('/.well-known/island.json', { body: JSON.stringify(built.manifest), type: 'application/json' });
    files.set('/island/friends.json', { body: JSON.stringify(built.friends), type: 'application/json' });
    for (const page of built.outbox) files.set(page.path, { body: JSON.stringify(page.document), type: 'application/json' });
    files.set('/feed.xml', { body: buildFeed({ config, records: list }), type: 'application/rss+xml' });
    files.set('/island/admin/', { body: '<!doctype html><title>admin</title>', type: 'text/html' });
    files.set('/', { body: '<!doctype html><title>home</title>', type: 'text/html' });
    return built;
  }
  let built = await publish();

  /** Static assets, with ETag and 304 like Cloudflare's. @param {Request} request */
  async function asset(request) {
    const path = new URL(request.url).pathname;
    const file = files.get(path) ?? (path.endsWith('/') ? null : files.get(`${path}/`));
    if (!file) return new Response('not found', { status: 404 });
    const etag = await etagOf(file.body);
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });
    // Like public/_headers: the public protocol paths are readable from any origin.
    const cors = path.startsWith('/island/') || path === '/.well-known/island.json' ? { 'access-control-allow-origin': '*' } : {};
    return new Response(file.body, { headers: { 'content-type': file.type, etag, ...cors } });
  }

  const service = createIsland({ storeFor: () => store, notify, fetch: net.fetch, now: time.now, resolver });
  /** @type {Promise<unknown>[]} */
  const pending = [];
  const fullEnv = { ASSETS: { fetch: asset }, ISLAND_SIGNING_KEY: seed, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ...env };
  const executionContext = { waitUntil: (/** @type {Promise<unknown>} */ promise) => pending.push(promise) };
  const serviceRoutes = /^\/island\/(inbox|go|compose|admin|api|ai)(\/|$)/;

  net.route(new URL(origin).host, (request) => {
    const path = new URL(request.url).pathname;
    return serviceRoutes.test(path) ? service.fetch(request, fullEnv, executionContext) : asset(request);
  });

  return {
    origin,
    store,
    get manifest() {
      return built.manifest;
    },
    env: fullEnv,
    files,
    /** Requests this island's service answers, as if from the internet. @param {string} path @param {RequestInit} [init] */
    async request(path, init) {
      const response = await net.fetch(`${origin}${path}`, init);
      await Promise.all(pending.splice(0));
      return response;
    },
    async cron() {
      const report = await service.scheduled({}, fullEnv, executionContext);
      await Promise.all(pending.splice(0));
      return report;
    },
    async settle() {
      await Promise.all(pending.splice(0));
    },
    /** Publishes a manifest with another key (no key log), as an imposter or a careless owner would. @param {string} newSeed */
    async rekey(newSeed) {
      seed = newSeed;
      fullEnv.ISLAND_SIGNING_KEY = newSeed;
      built = await publish();
    },
    /** Rebuilds the static files from changed records. @param {(list: any[]) => any[]} change */
    async republish(change) {
      recordInputs = change(recordInputs);
      built = await publish();
      return built;
    },
    rows: (/** @type {string} */ sql, /** @type {unknown[]} */ params = []) => store.all(sql, params),
  };
}

/** Owner API call helper. */
export function ownerCall(target, token) {
  return async (/** @type {string} */ path, /** @type {unknown} */ body) =>
    target.request(path, body === undefined
      ? { headers: { 'cf-access-jwt-assertion': token } }
      : { method: 'POST', headers: { 'cf-access-jwt-assertion': token, 'content-type': 'application/json', origin: target.origin }, body: JSON.stringify(body) });
}

export const SEEDS = Object.freeze({ a: 'a1'.repeat(32), b: 'b2'.repeat(32), c: 'c3'.repeat(32), d: 'd4'.repeat(32) });
