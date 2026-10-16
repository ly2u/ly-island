// The owner's API (/island/api/*, behind Cloudflare Access and checked
// again here) and the AI's API (/island/ai/*, bearer tokens with "read" or
// "draft" scope). There is no sending or publishing endpoint for AI tokens.

import { LIMITS, retrust } from '../../protocol/src/index.js';
import { isHttpsOrigin } from '../../protocol/src/util.js';
import { newToken, sameOriginJsonPost, tokenHash } from './auth.js';
import { send } from './deliver.js';
import { flushDigest, flushNow, sendToChannels } from './notify.js';
import { islandColumns, learnIsland, upsertIsland } from './remote.js';
import { pollNeighbors } from './poll.js';

/** @param {unknown} body @param {number} [status] @param {Record<string, string>} [headers] */
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}

/** @param {Request} request */
async function readJson(request) {
  const text = await request.text();
  if (text.length > 32 * 1024) return null;
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** @param {unknown} value */
const origin = (value) => (typeof value === 'string' && isHttpsOrigin(value) ? value : null);
/** @param {unknown} value @param {number} max */
const text = (value, max) => (typeof value === 'string' && value.trim() !== '' && Array.from(value).length <= max ? value : null);

/** @param {Record<string, any>} row */
function receivedView(row) {
  return { actor: row.actor, name: row.name ?? row.actor, id: row.id, type: row.type, folder: row.folder, received: new Date(row.received).toISOString(), read: row.read === 1, activity: JSON.parse(row.activity) };
}

/** @param {any} ctx @param {URL} url */
async function listInbox(ctx, url) {
  const folder = url.searchParams.get('folder') === 'strangers' ? 'strangers' : 'inbox';
  const before = Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER);
  const rows = await ctx.store.all(
    'SELECT r.*, i.name FROM received AS r LEFT JOIN islands AS i ON i.origin = r.actor WHERE r.folder = ? AND r.received < ? ORDER BY r.received DESC LIMIT 50',
    [folder, before],
  );
  return json({ folder, items: rows.map(receivedView) });
}

/** @param {any} ctx @param {URL} url */
async function listFeed(ctx, url) {
  const before = url.searchParams.get('before') ?? '9999';
  const rows = await ctx.store.all(
    'SELECT f.actor, f.activity, i.name FROM feed AS f LEFT JOIN islands AS i ON i.origin = f.actor WHERE f.published < ? ORDER BY f.published DESC LIMIT 50',
    [before],
  );
  return json({ items: rows.map((row) => ({ actor: row.actor, name: row.name ?? row.actor, activity: JSON.parse(row.activity) })) });
}

/** @param {any} ctx */
async function listIslands(ctx) {
  const rows = await ctx.store.all(
    'SELECT origin, name, following, follower, allowed, blocked, first_seen, history, poll FROM islands ORDER BY following DESC, follower DESC, name',
  );
  return json({
    items: rows.map((row) => ({
      origin: row.origin,
      name: row.name ?? row.origin,
      following: row.following === 1 || ctx.publicFriends.has(row.origin),
      publicFriend: ctx.publicFriends.has(row.origin),
      follower: row.follower === 1,
      allowed: row.allowed === 1,
      blocked: row.blocked === 1,
      paused: JSON.parse(row.history ?? 'null')?.status === 'paused',
      lastActivity: JSON.parse(row.poll ?? 'null')?.lastActivity ?? null,
    })),
  });
}

/**
 * The owner's API. The caller has already checked the Access token.
 * @param {any} ctx @param {Request} request @param {URL} url
 */
export async function ownerApi(ctx, request, url) {
  const route = url.pathname.slice('/island/api'.length);
  if (request.method === 'GET') {
    switch (route) {
      case '/me':
        return json({ who: 'owner', self: ctx.self, name: ctx.manifest.name, canSend: Boolean(ctx.signer), signingProblem: ctx.signerProblem ?? null, channels: ctx.policy.channels.map((/** @type {any} */ c) => c.type) });
      case '/inbox':
        return listInbox(ctx, url);
      case '/feed':
        return listFeed(ctx, url);
      case '/islands':
        return listIslands(ctx);
      case '/sent':
        return json({ items: (await ctx.store.all('SELECT id, recipient, type, created, status, attempts, last_error FROM sent ORDER BY created DESC LIMIT 50')).map((row) => ({ ...row, created: new Date(row.created).toISOString() })) });
      case '/drafts':
        return json({ items: (await ctx.store.all('SELECT * FROM drafts ORDER BY created DESC LIMIT 50')).map((row) => ({ ...row, data: JSON.parse(row.data) })) });
      case '/tokens':
        return json({ items: await ctx.store.all('SELECT hash, scope, label, created, revoked FROM tokens ORDER BY created DESC') });
      case '/export':
        return exportAll(ctx);
      default:
        return json({ error: 'not-found' }, 404);
    }
  }

  const csrf = sameOriginJsonPost(request, ctx.self);
  if (!csrf.ok) return json({ error: csrf.reason }, csrf.reason === 'method-not-allowed' ? 405 : 403);
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid-json' }, 400);
  const now = ctx.now();

  switch (route) {
    case '/inbox/read': {
      await ctx.store.run('UPDATE received SET read = 1 WHERE actor = ? AND id = ?', [String(body.actor), String(body.id)]);
      return json({ ok: true });
    }
    case '/islands': {
      const target = origin(body.origin);
      if (!target || target === ctx.self) return json({ error: 'invalid-origin' }, 400);
      const columns = { allow: ['allowed', 1], disallow: ['allowed', 0], block: ['blocked', 1], unblock: ['blocked', 0] };
      if (body.action === 'retrust') {
        const learned = await learnIsland(ctx, target, null, { force: true });
        if (!learned.ok) return json({ error: learned.reason }, 502);
        const history = await retrust(learned.manifest, { now: new Date(now).toISOString() });
        await ctx.store.batch([upsertIsland(target, now, { ...islandColumns(learned, now), history: JSON.stringify(history) }), ['UPDATE islands SET history = ? WHERE origin = ?', [JSON.stringify(history), target]]]);
        return json({ ok: true });
      }
      const change = columns[/** @type {keyof typeof columns} */ (body.action)];
      if (!change) return json({ error: 'invalid-action' }, 400);
      await ctx.store.batch([upsertIsland(target, now, {}), [`UPDATE islands SET ${change[0]} = ? WHERE origin = ?`, [change[1], target]]]);
      return json({ ok: true });
    }
    case '/follow': {
      const target = origin(body.origin);
      if (!target || target === ctx.self) return json({ error: 'invalid-origin' }, 400);
      await ctx.store.batch([upsertIsland(target, now, {}, { following: 1 }), ['UPDATE islands SET following = 1 WHERE origin = ?', [target]]]);
      return json(await send(ctx, { type: 'follow', to: target }));
    }
    case '/unfollow': {
      const target = origin(body.origin);
      if (!target) return json({ error: 'invalid-origin' }, 400);
      await ctx.store.run('UPDATE islands SET following = 0 WHERE origin = ?', [target]);
      return json({ ok: true, publicFriend: ctx.publicFriends.has(target) });
    }
    case '/send': {
      const target = origin(body.to);
      if (!target) return json({ error: 'invalid-recipient' }, 400);
      const object = sendObject(body);
      if (!object) return json({ error: 'invalid-content' }, 400);
      const result = await send(ctx, { type: body.type, to: target, object });
      if (result.id) await ctx.store.run('DELETE FROM drafts WHERE id = ?', [Number(body.draft ?? 0)]);
      return json(result, result.status === 'not-sent' ? 400 : 200);
    }
    case '/drafts/delete':
      await ctx.store.run('DELETE FROM drafts WHERE id = ?', [Number(body.id)]);
      return json({ ok: true });
    case '/tokens': {
      if (!['read', 'draft'].includes(body.scope)) return json({ error: 'scope must be read or draft' }, 400);
      const label = text(body.label, 64) ?? 'AI';
      const token = newToken();
      await ctx.store.run('INSERT INTO tokens (hash, scope, label, created) VALUES (?, ?, ?, ?)', [await tokenHash(token), body.scope, label, now]);
      return json({ token, scope: body.scope, label, note: 'Shown once. Only its hash is kept.' });
    }
    case '/tokens/revoke':
      await ctx.store.run('UPDATE tokens SET revoked = ? WHERE hash = ?', [now, String(body.hash)]);
      return json({ ok: true });
    case '/notify/test': {
      const failed = await sendToChannels(ctx, ctx.strings.notifyTitle, 'Test / 测试', []);
      return json({ ok: failed.length === 0, failed });
    }
    case '/poll': {
      const result = await pollNeighbors(ctx);
      await flushNow(ctx);
      return json(result);
    }
    case '/digest':
      return json({ sent: await flushDigest(ctx) });
    default:
      return json({ error: 'not-found' }, 404);
  }
}

/** The object of a message, visit or water. @param {Record<string, any>} body */
function sendObject(body) {
  if (body.type === 'visit') return {};
  if (body.type === 'water') {
    if (body.target === undefined) return {};
    return typeof body.target === 'string' && body.target.startsWith(`${body.to}/`) ? { target: body.target } : null;
  }
  if (body.type === 'message') {
    const message = text(body.text, LIMITS.messageText);
    if (!message) return null;
    const reply = body.inReplyTo === undefined || body.inReplyTo === '' ? undefined : String(body.inReplyTo);
    if (reply !== undefined && !reply.startsWith('https://')) return null;
    return { text: message, ...(reply ? { inReplyTo: reply } : {}), public: body.public === true };
  }
  return null;
}

/** Everything in the store, for moving house (docs/deployment.md "互动数据导出"). @param {any} ctx */
async function exportAll(ctx) {
  const tables = ['islands', 'received', 'sent', 'feed', 'events', 'drafts', 'state'];
  const results = await ctx.store.batch(tables.map((table) => /** @type {[string]} */ ([`SELECT * FROM ${table}`])));
  const tokens = await ctx.store.all('SELECT scope, label, created, revoked FROM tokens');
  const body = { exported: new Date(ctx.now()).toISOString(), island: ctx.self, ...Object.fromEntries(tables.map((table, i) => [table, results[i]])), tokens };
  return json(body, 200, { 'content-disposition': `attachment; filename="island-export-${new Date(ctx.now()).toISOString().slice(0, 10)}.json"` });
}

/**
 * The AI's API. The caller has already checked the token.
 * @param {any} ctx @param {Request} request @param {URL} url @param {{ scope: 'read' | 'draft', label: string }} token
 */
export async function aiApi(ctx, request, url, token) {
  const route = url.pathname.slice('/island/ai'.length);
  if (request.method === 'GET') {
    if (route === '/inbox') return listInbox(ctx, url);
    if (route === '/feed') return listFeed(ctx, url);
    if (route === '/islands') return listIslands(ctx);
    return json({ error: 'not-found' }, 404);
  }
  if (request.method === 'POST' && route === '/drafts') {
    if (token.scope !== 'draft') return json({ error: 'needs-draft-scope' }, 403);
    const body = await readJson(request);
    const target = origin(body?.to);
    const object = body ? sendObject({ ...body, type: body.type ?? 'message' }) : null;
    if (!body || !target || !object) return json({ error: 'invalid-draft' }, 400);
    await ctx.store.run('INSERT INTO drafts (type, data, created, by) VALUES (?, ?, ?, ?)', [body.type ?? 'message', JSON.stringify({ to: target, ...object }), ctx.now(), token.label]);
    return json({ ok: true, note: 'Saved as a draft. Only the owner can send it.' }, 201);
  }
  return json({ error: 'not-allowed' }, 403);
}
