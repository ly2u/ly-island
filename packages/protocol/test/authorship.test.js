import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canReplace, checkDelete, confirmMove, recordMigration, speaksFor } from '../src/authorship.js';
import { ZERO_SIGNATURE } from './helpers.js';

const A = 'https://a.example';
const B = 'https://b.example';
const B2 = 'https://b-new.example';

/** @param {string} actor @param {string} of */
function del(actor, of) {
  return { id: `${actor}/island/a/del`, type: 'delete', actor, published: '2026-10-14T00:00:00Z', to: 'public', object: { of }, proof: { key: `${actor}#k1`, value: ZERO_SIGNATURE } };
}

const bottleOfB = { id: `${B}/island/a/bottle-1`, type: 'bottle', actor: B, published: '2026-10-13T00:00:00Z', to: 'public', object: { text: 'hi' } };

describe('withdrawing', () => {
  it('lets the author withdraw their own activity', () => {
    assert.deepEqual(checkDelete(del(B, bottleOfB.id), { target: bottleOfB }), { ok: true, tombstone: bottleOfB.id });
    // Works before the target was seen, too: the id itself names the author.
    assert.equal(checkDelete(del(B, bottleOfB.id)).ok, true);
  });

  it("refuses A's validly signed delete of B's bottle, and leaves no tombstone", () => {
    const result = checkDelete(del(A, bottleOfB.id), { target: bottleOfB });
    assert.deepEqual(result, { ok: false, reason: 'not-author' });
    assert.equal('tombstone' in result, false);
    assert.equal(checkDelete(del(A, bottleOfB.id)).ok, false);
  });

  it('refuses a delete whose target does not match what is stored', () => {
    assert.deepEqual(checkDelete(del(B, `${B}/island/a/other`), { target: bottleOfB }), { ok: false, reason: 'target-mismatch' });
    assert.deepEqual(checkDelete(del(B, bottleOfB.id), { target: { ...bottleOfB, actor: A } }), { ok: false, reason: 'not-author' });
  });

  it('lets a moved island withdraw old activities only through a confirmed migration', () => {
    const fromNew = del(B2, bottleOfB.id);
    assert.equal(checkDelete(fromNew).ok, false);

    const move = { type: 'move', actor: B, object: { to: B2 } };
    assert.deepEqual(confirmMove(move, { id: B2 }), { ok: false, reason: 'not-acknowledged' });
    assert.deepEqual(confirmMove(move, { id: 'https://c.example', alsoKnownAs: [B] }), { ok: false, reason: 'target-mismatch' });

    const confirmed = confirmMove(move, { id: B2, alsoKnownAs: [B] });
    assert.equal(confirmed.ok, true);
    const migrations = recordMigration({}, B, B2);
    assert.equal(checkDelete(fromNew, { migrations }).ok, true);
  });

  it('follows migration chains, but not backwards and not in circles', () => {
    let migrations = recordMigration({}, B, B2);
    migrations = recordMigration(migrations, B2, 'https://b3.example');
    assert.equal(speaksFor(migrations, B, 'https://b3.example'), true);
    assert.equal(speaksFor(migrations, 'https://b3.example', B), false);
    const circle = recordMigration(recordMigration({}, A, B), B, A);
    assert.equal(speaksFor(circle, A, 'https://c.example'), false);
  });
});

describe('replacing', () => {
  const post = { id: `${A}/notes/x`, type: 'post', actor: A, published: '2026-10-13T00:00:00Z', to: 'public', object: {} };

  it('accepts a newer version from the same author', () => {
    assert.deepEqual(canReplace(post, { ...post, updated: '2026-10-14T00:00:00Z' }), { ok: true });
  });

  it('refuses older or equal versions, other authors and directed activities', () => {
    assert.deepEqual(canReplace(post, { ...post }), { ok: false, reason: 'not-newer' });
    assert.deepEqual(canReplace({ ...post, updated: '2026-10-14T00:00:00Z' }, { ...post, updated: '2026-10-13T12:00:00Z' }), {
      ok: false,
      reason: 'not-newer',
    });
    assert.deepEqual(canReplace(post, { ...post, actor: B, updated: '2026-10-14T00:00:00Z' }), { ok: false, reason: 'not-author' });
    const message = { ...post, type: 'message', to: [B] };
    assert.deepEqual(canReplace(message, { ...message, updated: '2026-10-14T00:00:00Z' }), { ok: false, reason: 'immutable' });
  });
});
