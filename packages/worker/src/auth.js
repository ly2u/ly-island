// Who is asking (docs/deployment.md "站主登录与凭据").
//
// - The owner: a Cloudflare Access token in Cf-Access-Jwt-Assertion, checked
//   here again (signature by kid against the team's certs, iss, aud, time).
//   Access in front is not trusted on its own, and this works on every
//   hostname the Worker answers on.
// - The owner's AI: a bearer token with scope "read" or "draft". Only its
//   SHA-256 is stored. AI tokens never reach owner or sending endpoints.
// - Other islands: signed activities, handled by the inbox.
// Missing configuration means no one is let in.

import { decodeBase64url as decode } from '../../protocol/src/index.js';

const JWKS_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_S = 60;

/** @type {Map<string, { at: number, keys: Record<string, any>[] }>} */
const jwksCache = new Map();

/** @param {string} part */
function decodeJson(part) {
  return JSON.parse(new TextDecoder().decode(decode(part)));
}

/**
 * @param {{ fetch: typeof fetch, budget: any, now: () => number }} ctx
 * @param {string} team https://<team>.cloudflareaccess.com
 * @param {string} kid
 */
async function signingKey(ctx, team, kid) {
  let cached = jwksCache.get(team);
  const stale = !cached || ctx.now() - cached.at > JWKS_TTL_MS;
  if (stale || !cached?.keys.some((key) => key.kid === kid)) {
    // Refetch at most once a minute for unknown key ids.
    if (stale || ctx.now() - (cached?.at ?? 0) > 60_000) {
      ctx.budget.take();
      const response = await ctx.fetch(`${team}/cdn-cgi/access/certs`, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return null;
      const body = await response.json();
      cached = { at: ctx.now(), keys: Array.isArray(body?.keys) ? body.keys : [] };
      jwksCache.set(team, cached);
    }
  }
  const jwk = cached?.keys.find((key) => key.kid === kid && key.kty === 'RSA');
  if (!jwk) return null;
  return crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

/** For tests: forget cached certificates. */
export function clearAccessCache() {
  jwksCache.clear();
}

/**
 * Checks the Cloudflare Access token of a request.
 * @param {{ fetch: typeof fetch, budget: any, now: () => number, env: Record<string, any> }} ctx
 * @param {Request} request
 * @returns {Promise<{ ok: true, who: 'owner', email: string | null } | { ok: false, reason: string }>}
 */
export async function owner(ctx, request) {
  const team = String(ctx.env.ACCESS_TEAM_DOMAIN ?? '').replace(/\/+$/, '');
  const aud = String(ctx.env.ACCESS_AUD ?? '');
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(team) || aud === '') return { ok: false, reason: 'access-not-configured' };
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return { ok: false, reason: 'no-token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed-token' };
  let header;
  let claims;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
  } catch {
    return { ok: false, reason: 'malformed-token' };
  }
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string') return { ok: false, reason: 'wrong-algorithm' };
  let key;
  try {
    key = await signingKey(ctx, team, header.kid);
  } catch {
    return { ok: false, reason: 'certs-unavailable' };
  }
  if (!key) return { ok: false, reason: 'unknown-key' };
  let signature;
  try {
    signature = decode(parts[2]);
  } catch {
    return { ok: false, reason: 'malformed-token' };
  }
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) return { ok: false, reason: 'bad-signature' };
  const now = Math.floor(ctx.now() / 1000);
  if (claims.iss !== team) return { ok: false, reason: 'wrong-issuer' };
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(aud)) return { ok: false, reason: 'wrong-audience' };
  if (typeof claims.exp !== 'number' || claims.exp <= now - CLOCK_SKEW_S) return { ok: false, reason: 'expired' };
  if (typeof claims.nbf === 'number' && claims.nbf > now + CLOCK_SKEW_S) return { ok: false, reason: 'not-yet-valid' };
  if (typeof claims.iat === 'number' && claims.iat > now + CLOCK_SKEW_S) return { ok: false, reason: 'not-yet-valid' };
  return { ok: true, who: 'owner', email: typeof claims.email === 'string' ? claims.email : null };
}

/** SHA-256 of a token, hex. @param {string} token */
export async function tokenHash(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A new random token: "isl_" and 43 base64url characters (256 bits). */
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `isl_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/**
 * Checks an AI token from "Authorization: Bearer isl_...".
 * @param {{ store: import('./store-d1.js').Store }} ctx @param {Request} request
 * @returns {Promise<{ ok: true, who: 'ai', scope: 'read' | 'draft', label: string } | { ok: false, reason: string }>}
 */
export async function aiToken(ctx, request) {
  const match = /^Bearer (isl_[A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '');
  if (!match) return { ok: false, reason: 'no-token' };
  const row = await ctx.store.first('SELECT scope, label FROM tokens WHERE hash = ? AND revoked IS NULL', [await tokenHash(match[1])]);
  if (!row) return { ok: false, reason: 'unknown-token' };
  return { ok: true, who: 'ai', scope: row.scope, label: row.label };
}

/**
 * Owner writes must be same-origin JSON POSTs (no forms, no GET with effects).
 * @param {Request} request @param {string} self
 */
export function sameOriginJsonPost(request, self) {
  if (request.method !== 'POST') return { ok: false, reason: 'method-not-allowed' };
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '')) return { ok: false, reason: 'not-json' };
  if (request.headers.get('origin') !== self) return { ok: false, reason: 'wrong-origin' };
  return { ok: true };
}
