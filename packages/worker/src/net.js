// Outbound requests (protocol "出站请求"). Every address that came from
// someone else's data goes through here: manifests, outboxes, next pages,
// key logs, friends lists and inbox deliveries.
//
// - Address rules from @islands/protocol: https only, no credentials, no
//   ports, no IP literals or local names, same origin where required.
// - A resolver, when the platform has one (self-hosting), checks every
//   address a name resolves to before connecting. That alone does not stop
//   DNS rebinding: fetch() resolves the name again. The self-hosting
//   adapter (phase 4) must connect to the address that was checked; until
//   then this check is a first line only, and is not counted as protection
//   against rebinding.
// - On Cloudflare Workers there is no resolver: connections leave from
//   Cloudflare's network (global_fetch_strictly_public routes every fetch as
//   from the public internet), and Workers cannot choose the address used.
// - GET follows at most 3 redirects on the same origin; POST follows none.
// - Only headers built by buildOutboundHeaders(); 10 s timeout; bodies over
//   the limit are cut off and refused.
// - Every request and redirect hop is charged to the run's budget.

import {
  buildOutboundHeaders,
  checkOutboundHeaders,
  checkOutboundUrl,
  checkRedirect,
  checkResolvedAddresses,
  TIMEOUT_MS,
} from '../../protocol/src/index.js';

export class OutboundError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

/** @param {Response} response @param {number} limit */
async function readLimited(response, limit) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel();
    throw new OutboundError('too-large');
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new OutboundError('too-large');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

/**
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {string} options.self this island's origin, for the User-Agent
 * @param {ReturnType<typeof import('./budget.js').budget>} options.budget
 * @param {((host: string) => Promise<string[]>) | null} [options.resolver]
 */
export function outbound({ fetch, self, budget, resolver = null }) {
  /** @param {URL} url */
  async function checkHost(url) {
    if (!resolver) return;
    const check = checkResolvedAddresses(await resolver(url.hostname));
    if (!check.ok) throw new OutboundError(check.reason);
  }

  /**
   * @param {string} method @param {URL} url @param {Record<string, string>} headers @param {Uint8Array | undefined} body
   */
  async function send(method, url, headers, body) {
    const headerCheck = checkOutboundHeaders(headers);
    if (!headerCheck.ok) throw new OutboundError(headerCheck.reason);
    await checkHost(url);
    budget.take();
    try {
      return await fetch(url.href, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      if (error instanceof OutboundError) throw error;
      throw new OutboundError(/** @type {Error} */ (error)?.name === 'TimeoutError' ? 'timeout' : 'network-error');
    }
  }

  return {
    /**
     * A conditional GET of public data.
     * @param {string} address
     * @param {{ sameOriginAs?: string, etag?: string | null, lastModified?: string | null, kind?: 'read' | 'feed', limit: number }} options
     * @returns {Promise<{ status: number, url: string, body: Uint8Array, etag: string | null, lastModified: string | null, retryAfter: number | null }>}
     */
    async get(address, { sameOriginAs, etag = null, lastModified = null, kind = 'read', limit }) {
      const first = checkOutboundUrl(address, { sameOriginAs });
      if (!first.ok) throw new OutboundError(first.reason);
      let url = first.url;
      const headers = buildOutboundHeaders({ kind, self, etag, lastModified });
      for (let hops = 0; ; hops += 1) {
        const response = await send('GET', url, headers, undefined);
        if (response.status >= 300 && response.status < 400 && response.status !== 304) {
          await response.body?.cancel();
          const next = checkRedirect({ method: 'GET', from: url.href, location: response.headers.get('location'), hops });
          if (!next.ok) throw new OutboundError(next.reason);
          url = next.url;
          continue;
        }
        const ok = response.status >= 200 && response.status < 300;
        const body = ok ? await readLimited(response, limit) : (await response.body?.cancel(), new Uint8Array(0));
        return {
          status: response.status,
          url: url.href,
          body,
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
          retryAfter: retryAfterSeconds(response.headers.get('retry-after')),
        };
      }
    },

    /**
     * An inbox delivery. Redirects are never followed.
     * @param {string} address @param {Uint8Array} body @param {{ sameOriginAs: string }} options
     * @returns {Promise<{ status: number, retryAfter: number | null }>}
     */
    async post(address, body, { sameOriginAs }) {
      const target = checkOutboundUrl(address, { sameOriginAs });
      if (!target.ok) throw new OutboundError(target.reason);
      const response = await send('POST', target.url, buildOutboundHeaders({ kind: 'deliver', self }), body);
      await response.body?.cancel();
      if (response.status >= 300 && response.status < 400) throw new OutboundError('redirect-not-followed');
      return { status: response.status, retryAfter: retryAfterSeconds(response.headers.get('retry-after')) };
    },
  };
}

/** @param {string | null} value seconds or an HTTP date */
export function retryAfterSeconds(value, now = Date.now()) {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Math.min(Number(value), 86_400);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, Math.min(Math.ceil((at - now) / 1000), 86_400)) : null;
}

/** Parses JSON bytes, or returns undefined. @param {Uint8Array} body */
export function parseJson(body) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return undefined;
  }
}
