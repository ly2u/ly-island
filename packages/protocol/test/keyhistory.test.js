import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateKeyLog } from '../src/documents.js';
import { chainDigest, compareManifest, pause, resolveKey, retrust, syncKeyLog, trustOnFirstUse, verifyActivity } from '../src/keyhistory.js';
import { makeKey, manifestFor, SEEDS, signWith, unsignedPost } from './helpers.js';

const A = 'https://example.org';
const NOW = '2026-10-01T00:00:00Z';

async function keys() {
  return {
    k1: await makeKey(A, 'k1', SEEDS.k1),
    k2: await makeKey(A, 'k2', SEEDS.k2),
    k3: await makeKey(A, 'k3', SEEDS.k3),
    attacker: await makeKey(A, 'k9', SEEDS.stranger),
  };
}

/**
 * @param {Awaited<ReturnType<typeof makeKey>>} signer
 * @param {string} id
 * @param {string} published
 * @param {Record<string, any>} object
 */
function keyChange(signer, id, published, object) {
  return signWith(signer, { id: `${A}/island/keys/${id}`, type: 'key', actor: A, published, to: 'public', object });
}

/** @param {Awaited<ReturnType<typeof makeKey>>} key */
function added(key) {
  return { id: key.keyId, type: 'Ed25519', publicKey: key.publicKey };
}

/** @param {Record<string, any>[]} items */
function keyLog(items) {
  const log = { protocol: 'islands/0', id: `${A}/island/keys.json`, owner: A, updated: '2026-10-14T00:00:00Z', items };
  assert.equal(validateKeyLog(log).ok, true, JSON.stringify(validateKeyLog(log).issues));
  return log;
}

describe('key history', () => {
  it('rotates k1 to k2 even when the new manifest lists only k2', async () => {
    const { k1, k2 } = await keys();
    const history = await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW });
    const rotation = await keyChange(k1, 'r1', '2026-10-10T00:00:00Z', { add: added(k2), revoke: k1.keyId, reason: 'retired' });

    const newManifest = manifestFor(A, [k2]);
    assert.equal(compareManifest(history, newManifest).status, 'needs-sync');

    const synced = await syncKeyLog(history, keyLog([rotation]));
    assert.equal(synced.outcome, 'applied');
    assert.equal(compareManifest(synced.history, newManifest).status, 'consistent');

    const post = await signWith(k2, unsignedPost(A, { published: '2026-10-12T00:00:00Z' }));
    assert.deepEqual(await verifyActivity(synced.history, post, { source: 'relay', delivery: false }), { ok: true });
  });

  it('does not let a new key vouch for itself', async () => {
    const { k1, k2 } = await keys();
    const history = await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW });
    // The manifest now shows only k2, and the key log has nothing signed by a trusted key.
    assert.equal(compareManifest(history, manifestFor(A, [k2])).status, 'needs-sync');
    const selfIntroduced = await keyChange(k2, 'r1', '2026-10-10T00:00:00Z', { add: added(k2) });
    const synced = await syncKeyLog(history, keyLog([]));
    assert.equal(synced.outcome, 'up-to-date');
    assert.equal(compareManifest(synced.history, manifestFor(A, [k2])).status, 'needs-sync');
    // The caller pauses when keys stay unknown after a sync.
    assert.equal(pause(synced.history, 'unknown-key').status, 'paused');
    // A key log entry signed by the unknown key breaks the chain.
    const broken = await syncKeyLog(history, { owner: A, items: [selfIntroduced] });
    assert.equal(broken.outcome, 'paused');
    assert.equal(broken.reason, 'chain-broken');
    const post = await signWith(k2, unsignedPost(A));
    assert.deepEqual(await verifyActivity(history, post, { source: 'origin', delivery: false }), { ok: false, reason: 'unknown-key' });
  });

  it('refuses new deliveries signed by a revoked key', async () => {
    const { k1, k2 } = await keys();
    const history = await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW });
    const rotation = await keyChange(k1, 'r1', '2026-10-10T00:00:00Z', { add: added(k2), revoke: k1.keyId });
    const { history: rotated } = await syncKeyLog(history, keyLog([rotation]));
    const message = await signWith(k1, {
      id: `${A}/island/a/1`,
      type: 'message',
      actor: A,
      published: '2026-10-11T00:00:00Z',
      to: ['https://neighbor.example'],
      object: { text: 'hi' },
    });
    assert.deepEqual(await verifyActivity(rotated, message, { source: 'origin', delivery: true }), { ok: false, reason: 'revoked-key' });
  });

  it('keeps old public activities from the origin, but not relayed copies', async () => {
    const { k1, k2 } = await keys();
    const history = await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW });
    const rotation = await keyChange(k1, 'r1', '2026-10-10T00:00:00Z', { add: added(k2), revoke: k1.keyId, reason: 'retired' });
    const { history: rotated } = await syncKeyLog(history, keyLog([rotation]));

    const before = await signWith(k1, unsignedPost(A, { published: '2026-10-09T00:00:00Z' }));
    const after = await signWith(k1, unsignedPost(A, { published: '2026-10-10T00:00:00Z' }));
    assert.deepEqual(await verifyActivity(rotated, before, { source: 'origin', delivery: false }), { ok: true });
    assert.deepEqual(await verifyActivity(rotated, before, { source: 'relay', delivery: false }), { ok: false, reason: 'revoked-key' });
    assert.deepEqual(await verifyActivity(rotated, after, { source: 'origin', delivery: false }), { ok: false, reason: 'revoked-key' });
  });

  it('refuses everything signed by a compromised key', async () => {
    const { k1, k2 } = await keys();
    const history = await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW });
    const rotation = await keyChange(k1, 'r1', '2026-10-10T00:00:00Z', { add: added(k2), revoke: k1.keyId, reason: 'compromised' });
    const { history: rotated } = await syncKeyLog(history, keyLog([rotation]));
    const old = await signWith(k1, unsignedPost(A, { published: '2026-01-01T00:00:00Z' }));
    assert.deepEqual(await verifyActivity(rotated, old, { source: 'origin', delivery: false }), { ok: false, reason: 'compromised-key' });
  });

  it('catches up across several rotations after a long time offline', async () => {
    const { k1, k2, k3 } = await keys();
    const history = await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW });
    const log = keyLog([
      await keyChange(k1, 'r1', '2026-10-02T00:00:00Z', { add: added(k2), revoke: k1.keyId }),
      await keyChange(k2, 'r2', '2026-10-03T00:00:00Z', { add: added(k3), revoke: k2.keyId }),
    ]);
    const synced = await syncKeyLog(history, log);
    assert.equal(synced.applied, 2);
    assert.equal(synced.history.logHead?.id, `${A}/island/keys/r2`);
    assert.equal(synced.history.logHead?.index, 1);
    assert.equal(synced.history.logHead?.digest, await chainDigest(log.items, 1));
    assert.equal(compareManifest(synced.history, manifestFor(A, [k3])).status, 'consistent');
    // Syncing again is a no-op.
    assert.equal((await syncKeyLog(synced.history, log)).outcome, 'up-to-date');
  });

  it('starts after the log head anchored at first contact', async () => {
    const { k1, k2, k3 } = await keys();
    const earlier = await keyChange(k1, 'r1', '2026-09-01T00:00:00Z', { add: added(k2), revoke: k1.keyId });
    // First contact happens after r1: the manifest lists k2 and the log already holds r1.
    const history = await trustOnFirstUse(manifestFor(A, [k2]), { now: NOW, keyLog: keyLog([earlier]) });
    assert.deepEqual(history.logHead, { id: earlier.id, index: 0, digest: await chainDigest([earlier], 0) });
    const later = await keyChange(k2, 'r2', '2026-10-05T00:00:00Z', { add: added(k3), revoke: k2.keyId });
    const synced = await syncKeyLog(history, keyLog([earlier, later]));
    assert.equal(synced.outcome, 'applied');
    assert.equal(synced.applied, 1);
  });

  it('pauses when a revoked key keeps signing key changes (fork)', async () => {
    const { k1, k2, attacker } = await keys();
    const history = await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW });
    const rotation = await keyChange(k1, 'r1', '2026-10-02T00:00:00Z', { add: added(k2), revoke: k1.keyId });
    const { history: rotated } = await syncKeyLog(history, keyLog([rotation]));
    // Someone who still holds k1 appends a change that adds their own key.
    const forged = await keyChange(k1, 'r2', '2026-10-03T00:00:00Z', { add: added(attacker) });
    const result = await syncKeyLog(rotated, { owner: A, items: [rotation, forged] });
    assert.equal(result.outcome, 'paused');
    assert.equal(result.reason, 'fork');
    assert.equal(result.history.keys.some((key) => key.id === attacker.keyId), false);
  });

  it('pauses when an entry up to the head disappears', async () => {
    const { k1, k2, k3 } = await keys();
    const r1 = await keyChange(k1, 'r1', '2026-10-02T00:00:00Z', { add: added(k2) });
    const r2 = await keyChange(k1, 'r2', '2026-10-03T00:00:00Z', { add: added(k3) });
    const { history } = await syncKeyLog(await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW }), keyLog([r1, r2]));
    const result = await syncKeyLog(history, keyLog([r2]));
    assert.equal(result.reason, 'log-rewritten');
  });

  it('pauses when the head is rewritten under the same id, and keeps the old history', async () => {
    const { k1, k2, k3 } = await keys();
    const head = await keyChange(k1, 'head', '2026-10-02T00:00:00Z', { add: added(k2) });
    const { history } = await syncKeyLog(await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW }), keyLog([head]));
    // Same id and time, correctly signed by k1, but now it introduces k3.
    const rewritten = await keyChange(k1, 'head', '2026-10-02T00:00:00Z', { add: added(k3) });
    const result = await syncKeyLog(history, keyLog([rewritten]));
    assert.equal(result.outcome, 'paused');
    assert.equal(result.reason, 'log-rewritten');
    assert.equal(result.history.keys.some((key) => key.id === k3.keyId), false);
    assert.deepEqual(result.history.keys, history.keys);
  });

  it('pauses when an earlier entry is rewritten while the head stays the same', async () => {
    const { k1, k2, k3, attacker } = await keys();
    const r1 = await keyChange(k1, 'r1', '2026-10-02T00:00:00Z', { add: added(k2) });
    const r2 = await keyChange(k1, 'r2', '2026-10-03T00:00:00Z', { add: added(k3) });
    const { history } = await syncKeyLog(await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW }), keyLog([r1, r2]));
    const r1b = await keyChange(k1, 'r1', '2026-10-02T00:00:00Z', { add: added(attacker) });
    assert.equal((await syncKeyLog(history, keyLog([r1b, r2]))).reason, 'log-rewritten');
  });

  it('pauses when the log anchored at first contact is rewritten', async () => {
    const { k1, k2, k3 } = await keys();
    const r1 = await keyChange(k1, 'r1', '2026-09-01T00:00:00Z', { add: added(k2) });
    const history = await trustOnFirstUse(manifestFor(A, [k1, k2]), { now: NOW, keyLog: keyLog([r1]) });
    const r1b = await keyChange(k1, 'r1', '2026-09-01T00:00:00Z', { add: added(k3) });
    const r2 = await keyChange(k1, 'r2', '2026-10-05T00:00:00Z', { add: added(k3) });
    assert.equal((await syncKeyLog(history, keyLog([r1b, r2]))).reason, 'log-rewritten');
  });

  it('refuses a key log that reuses an activity id, before changing anything', async () => {
    const { k1, k2, k3 } = await keys();
    // Both entries are validly signed, but share one id: the head would be ambiguous.
    const first = await keyChange(k1, 'same', '2026-10-02T00:00:00Z', { add: added(k2), revoke: k1.keyId });
    const second = await keyChange(k2, 'same', '2026-10-03T00:00:00Z', { add: added(k3), revoke: k2.keyId });
    const log = { protocol: 'islands/0', id: `${A}/island/keys.json`, owner: A, updated: '2026-10-14T00:00:00Z', items: [first, second] };
    assert.ok(validateKeyLog(log).issues.some((issue) => issue.code === 'duplicate-id'));
    const history = await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW });
    const result = await syncKeyLog(history, log);
    assert.equal(result.reason, 'invalid-key-log');
    assert.deepEqual(result.history.keys, history.keys);
    assert.equal((await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW, keyLog: log })).status, 'paused');
  });

  it('stays up to date when the same log is synced again after several rotations', async () => {
    const { k1, k2, k3 } = await keys();
    const log = keyLog([
      await keyChange(k1, 'r1', '2026-10-02T00:00:00Z', { add: added(k2), revoke: k1.keyId }),
      await keyChange(k2, 'r2', '2026-10-03T00:00:00Z', { add: added(k3), revoke: k2.keyId }),
    ]);
    let { history } = await syncKeyLog(await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW }), log);
    for (let i = 0; i < 3; i += 1) {
      const again = await syncKeyLog(history, structuredClone(log));
      assert.equal(again.outcome, 'up-to-date');
      history = again.history;
    }
  });

  it('pauses when a key id is reused for another public key', async () => {
    const { k1, k2, k3 } = await keys();
    const fresh = await trustOnFirstUse(manifestFor(A, [k1, k2]), { now: NOW });
    const clash = await keyChange(k1, 'r1', '2026-10-02T00:00:00Z', { add: { ...added(k3), id: k2.keyId } });
    assert.equal((await syncKeyLog(fresh, keyLog([clash]))).reason, 'key-mismatch');
    assert.equal(compareManifest(fresh, manifestFor(A, [{ ...k3, keyId: k2.keyId }])).status, 'mismatch');
  });

  describe('a failed sync keeps the history it was given', () => {
    /**
     * @param {Awaited<ReturnType<typeof trustOnFirstUse>>} before
     * @param {Awaited<ReturnType<typeof syncKeyLog>>} result
     * @param {string} reason
     */
    function assertUnchangedButPaused(before, result, reason) {
      assert.equal(result.outcome, 'paused');
      assert.equal(result.reason, reason);
      assert.equal(result.applied, 0);
      assert.deepEqual(result.history, { ...before, status: 'paused', pauseReason: reason });
    }

    it('when a valid entry is followed by one with a bad signature', async () => {
      const { k1, k2, k3 } = await keys();
      const history = await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW });
      const snapshot = structuredClone(history);
      const r1 = await keyChange(k1, 'r1', '2026-10-02T00:00:00Z', { add: added(k2), revoke: k1.keyId });
      const signedByK2 = await keyChange(k2, 'r2', '2026-10-03T00:00:00Z', { add: added(k3) });
      // Well-formed, but the signature belongs to other bytes.
      const r2 = { ...signedByK2, proof: { key: k2.keyId, value: r1.proof.value } };
      const result = await syncKeyLog(history, keyLog([r1, r2]));
      assertUnchangedButPaused(snapshot, result, 'chain-broken');
      assert.deepEqual(history, snapshot);
    });

    it('when a valid entry is followed by a key id clash', async () => {
      const { k1, k2, k3 } = await keys();
      const history = await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW });
      const r1 = await keyChange(k1, 'r1', '2026-10-02T00:00:00Z', { add: added(k2) });
      const r2 = await keyChange(k1, 'r2', '2026-10-03T00:00:00Z', { add: { ...added(k3), id: k2.keyId } });
      assertUnchangedButPaused(history, await syncKeyLog(history, keyLog([r1, r2])), 'key-mismatch');
    });

    it('when a valid rotation is followed by a change signed with the revoked key', async () => {
      const { k1, k2, attacker } = await keys();
      const history = await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW });
      const r1 = await keyChange(k1, 'r1', '2026-10-02T00:00:00Z', { add: added(k2), revoke: k1.keyId });
      const r2 = await keyChange(k1, 'r2', '2026-10-03T00:00:00Z', { add: added(attacker) });
      assertUnchangedButPaused(history, await syncKeyLog(history, keyLog([r1, r2])), 'fork');
    });

    it('when the failure comes after entries appended to an anchored head', async () => {
      const { k1, k2, k3 } = await keys();
      const r1 = await keyChange(k1, 'r1', '2026-10-02T00:00:00Z', { add: added(k2) });
      const { history } = await syncKeyLog(await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW }), keyLog([r1]));
      const r2 = await keyChange(k1, 'r2', '2026-10-03T00:00:00Z', { add: added(k3) });
      const r3 = { ...(await keyChange(k2, 'r3', '2026-10-04T00:00:00Z', { revoke: k1.keyId })), proof: { key: k2.keyId, value: r1.proof.value } };
      const result = await syncKeyLog(history, keyLog([r1, r2, r3]));
      assertUnchangedButPaused(history, result, 'chain-broken');
      assert.equal(result.history.logHead?.id, r1.id);
      assert.equal(result.history.keys.some((key) => key.id === k3.keyId), false);
    });
  });

  it('stays paused until the owner confirms, then starts over', async () => {
    const { k1, k2 } = await keys();
    const paused = pause(await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW }), 'unknown-key');
    const post = await signWith(k1, unsignedPost(A));
    assert.deepEqual(await verifyActivity(paused, post, { source: 'origin', delivery: false }), { ok: false, reason: 'paused' });
    assert.equal(resolveKey(paused, k1.keyId, { published: post.published, source: 'origin', delivery: false }).ok, false);
    const restarted = await retrust(manifestFor(A, [k2]), { now: '2026-10-14T00:00:00Z' });
    assert.equal(restarted.status, 'trusted');
    assert.deepEqual(restarted.keys.map((key) => key.id), [k2.keyId]);
  });

  it('never changes the history it was given', async () => {
    const { k1, k2 } = await keys();
    const history = await trustOnFirstUse(manifestFor(A, [k1]), { now: NOW });
    const snapshot = structuredClone(history);
    await syncKeyLog(history, keyLog([await keyChange(k1, 'r1', '2026-10-02T00:00:00Z', { add: added(k2), revoke: k1.keyId })]));
    assert.deepEqual(history, snapshot);
  });
});
