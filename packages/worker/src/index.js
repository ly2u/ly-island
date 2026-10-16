// The island service as a Web-standard handler: { fetch, scheduled }.
// Platform pieces come in from outside (the store, the assets, fetch, the
// clock), so the same code runs on Cloudflare Workers, in Node for tests,
// and later on a self-hosted server.
//
// Routes (everything else is static and never reaches this code):
//   POST /island/inbox          other islands' deliveries (public)
//   GET  /island/go             "reply from my island": to the visitor's compose page (public)
//   GET  /island/compose        the owner's compose view (owner)
//   *    /island/admin/...      the owner's pages (owner; served from the static assets)
//   *    /island/api/...        the owner's API (owner)
//   *    /island/ai/...         the owner's AI (bearer token, read or draft)
//   cron                        neighbor sync, delivery retries, notifications

import { encodeBase64url, importPrivateSeed, publicKeyOf } from '../../protocol/src/index.js';
import { isHttpsOrigin } from '../../protocol/src/util.js';
import { aiApi, json, ownerApi } from './api.js';
import { aiToken, owner } from './auth.js';
import { budget, countedStore } from './budget.js';
import { retryDue } from './deliver.js';
import { receive } from './inbox.js';
import { outbound } from './net.js';
import { checkPolicy, flushDigest, flushNow } from './notify.js';
import { pollNeighbors } from './poll.js';
import { migrate } from './schema.js';
import { stringsFor } from './strings.js';

export { cronFor } from './util.js';
export { d1Store } from './store-d1.js';

/** Subrequests one invocation may use, below the free plan's 50. */
export const BUDGET = 45;

/**
 * @param {object} options
 * @param {(env: Record<string, any>) => import('./store-d1.js').Store} options.storeFor
 * @param {Record<string, any>} [options.notify] the owner's notification policy (island/notify.json)
 * @param {string} [options.timeZone] the island's time zone, the default for the policy
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 * @param {((host: string) => Promise<string[]>) | null} [options.resolver]
 */
export function createIsland({ storeFor, notify = {}, timeZone = 'UTC', fetch = globalThis.fetch.bind(globalThis), now = Date.now, resolver = null }) {
  let migrated = false;
  /** @type {Promise<{ manifest: Record<string, any>, publicFriends: Set<string> }> | null} */
  let selfData = null;
  /** @type {{ seed: string, signer: any, problem: string | null } | null} */
  let signerCache = null;

  /** This island's own public data, read once per isolate from the static assets. @param {Record<string, any>} env */
  function loadSelf(env) {
    selfData ??= (async () => {
      const read = async (/** @type {string} */ path) => {
        const response = await env.ASSETS.fetch(new Request(`https://assets.local${path}`));
        return response.ok ? response.json() : null;
      };
      const manifest = await read('/.well-known/island.json');
      if (!manifest || !isHttpsOrigin(manifest.id)) throw new Error('the static assets have no valid /.well-known/island.json');
      const friends = await read('/island/friends.json');
      const publicFriends = new Set((friends?.items ?? []).filter((/** @type {any} */ item) => !item.feed).map((/** @type {any} */ item) => item.id));
      return { manifest, publicFriends };
    })().catch((error) => {
      selfData = null;
      throw error;
    });
    return selfData;
  }

  /** The runtime signing key, which must match the manifest. @param {Record<string, any>} env @param {Record<string, any>} manifest */
  async function loadSigner(env, manifest) {
    const seed = String(env.ISLAND_SIGNING_KEY ?? '').trim().toLowerCase();
    if (signerCache?.seed === seed) return signerCache;
    let signer = null;
    let problem = null;
    if (!/^[0-9a-f]{64}$/.test(seed)) {
      problem = 'ISLAND_SIGNING_KEY is not set for the Worker';
    } else {
      const privateKey = await importPrivateSeed(Uint8Array.from(seed.match(/../g) ?? [], (byte) => parseInt(byte, 16)));
      const publicKey = encodeBase64url(await publicKeyOf(privateKey));
      const key = (manifest.keys ?? []).find((/** @type {any} */ entry) => entry.publicKey === publicKey);
      if (key) signer = { keyId: key.id, privateKey };
      else problem = 'ISLAND_SIGNING_KEY does not match the key in the manifest';
    }
    signerCache = { seed, signer, problem };
    return signerCache;
  }

  /** Everything one invocation needs, with one budget. @param {Record<string, any>} env @param {(p: Promise<unknown>) => void} later */
  async function context(env, later) {
    const spend = budget(BUDGET);
    const store = countedStore(storeFor(env), spend);
    if (!migrated) {
      await migrate(store);
      migrated = true;
    }
    const { manifest, publicFriends } = await loadSelf(env);
    const self = manifest.id;
    const language = Array.isArray(manifest.language) ? manifest.language[0] : 'en';
    const policy = checkPolicy(notify, timeZone);
    const { signer, problem } = await loadSigner(env, manifest);
    /** @type {any} */
    const ctx = {
      env,
      self,
      manifest,
      publicFriends,
      store,
      budget: spend,
      now,
      fetch,
      net: outbound({ fetch, self, budget: spend, resolver }),
      policy,
      strings: stringsFor(language),
      signer,
      signerProblem: problem,
      later,
    };
    ctx.flushNotifications = () => flushNow(ctx).catch(() => 0);
    return ctx;
  }

  return {
    /** @param {Request} request @param {Record<string, any>} env @param {{ waitUntil(p: Promise<unknown>): void }} executionContext */
    async fetch(request, env, executionContext) {
      const url = new URL(request.url);
      const path = url.pathname;
      const later = (/** @type {Promise<unknown>} */ promise) => executionContext.waitUntil(promise);
      try {
        if (path === '/island/inbox') return receive(await context(env, later), request);
        if (path === '/island/go') return goHome(await context(env, later), url);
        if (path === '/island/ai' || path.startsWith('/island/ai/')) {
          const ctx = await context(env, later);
          const token = await aiToken(ctx, request);
          if (!token.ok) return json({ error: token.reason }, 401, { 'www-authenticate': 'Bearer' });
          return aiApi(ctx, request, url, token);
        }
        if (path === '/island/compose' || path === '/island/admin' || path.startsWith('/island/admin/') || path === '/island/api' || path.startsWith('/island/api/')) {
          const ctx = await context(env, later);
          const who = await owner(ctx, request);
          if (!who.ok) return json({ error: 'owner-only', reason: who.reason }, 403);
          if (path === '/island/compose') return Response.redirect(`${ctx.self}/island/admin/#compose${url.search}`, 303);
          if (path.startsWith('/island/api')) return await ownerApi(ctx, request, url);
          const page = await env.ASSETS.fetch(request);
          const headers = new Headers(page.headers);
          headers.set('cache-control', 'no-store');
          return new Response(page.body, { status: page.status, headers });
        }
        return env.ASSETS.fetch(request);
      } catch (error) {
        console.error('island service error', error);
        return json({ error: 'service-error' }, 503, { 'retry-after': '60' });
      }
    },

    /** @param {unknown} _controller @param {Record<string, any>} env @param {{ waitUntil(p: Promise<unknown>): void }} executionContext */
    async scheduled(_controller, env, executionContext) {
      const ctx = await context(env, (promise) => executionContext.waitUntil(promise));
      const report = { retried: 0, polled: /** @type {string[]} */ ([]), verified: 0, notified: 0, digest: 0, used: 0 };
      try {
        report.retried = await retryDue(ctx, 3);
        const polled = await pollNeighbors(ctx);
        report.polled = polled.polled;
        report.verified = polled.verified;
        report.notified = await flushNow(ctx);
        report.digest = await flushDigest(ctx);
      } finally {
        report.used = ctx.budget.used;
        console.log('island cron', JSON.stringify(report));
      }
      return report;
    },
  };
}

/**
 * "Reply from my island": sends the visitor to their own island's compose
 * page (its links.compose, same origin as their island).
 * @param {any} ctx @param {URL} url
 */
async function goHome(ctx, url) {
  const home = url.searchParams.get('home') ?? '';
  const type = url.searchParams.get('type') ?? 'message';
  if (!isHttpsOrigin(home) || !['message', 'visit', 'water', 'follow'].includes(type)) return json({ error: 'home must be the https address of your island' }, 400);
  let compose = `${home}/island/compose`;
  try {
    const response = await ctx.net.get(`${home}/.well-known/island.json`, { sameOriginAs: home, limit: 64 * 1024 });
    const manifest = response.status === 200 ? JSON.parse(new TextDecoder().decode(response.body)) : null;
    if (typeof manifest?.links?.compose === 'string' && manifest.links.compose.startsWith(`${home}/`)) compose = manifest.links.compose;
  } catch {
    // Fall back to the default address.
  }
  const target = new URL(compose);
  target.searchParams.set('type', type);
  target.searchParams.set('to', ctx.self);
  const inReplyTo = url.searchParams.get('inReplyTo');
  if (inReplyTo?.startsWith(`${ctx.self}/`)) target.searchParams.set('inReplyTo', inReplyTo);
  const returnTo = url.searchParams.get('returnTo');
  if (returnTo?.startsWith(`${ctx.self}/`)) target.searchParams.set('returnTo', returnTo);
  return Response.redirect(target.href, 303);
}
