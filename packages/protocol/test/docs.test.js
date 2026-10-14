// The JSON examples in docs/protocol-v0.md must be valid, and the signed
// examples must verify against the example manifest key.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { validateActivity } from '../src/activity.js';
import { validateFriends, validateManifest, validateOutbox } from '../src/documents.js';
import { trustOnFirstUse, verifyActivity } from '../src/keyhistory.js';

const DOC = new URL('../../../docs/protocol-v0.md', import.meta.url);

/** @returns {{ kind: string, value: any }[]} */
export function docExamples() {
  const text = readFileSync(DOC, 'utf8');
  return [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => {
    const value = JSON.parse(match[1]);
    let kind = 'other';
    if (value.protocol && value.keys) kind = 'manifest';
    else if (value.protocol && String(value.id).endsWith('outbox.json')) kind = 'outbox';
    else if (value.protocol && String(value.id).endsWith('friends.json')) kind = 'friends';
    else if (value.type && value.actor) kind = 'activity';
    return { kind, value };
  });
}

describe('protocol document examples', () => {
  const examples = docExamples();

  it('are all recognised', () => {
    assert.deepEqual(
      examples.map((example) => example.kind).sort(),
      ['activity', 'activity', 'friends', 'manifest', 'outbox'],
    );
  });

  it('pass validation', () => {
    for (const { kind, value } of examples) {
      const result =
        kind === 'manifest'
          ? validateManifest(value, { fetchedOrigin: value.id })
          : kind === 'outbox'
            ? validateOutbox(value)
            : kind === 'friends'
              ? validateFriends(value)
              : validateActivity(value);
      assert.deepEqual(result.issues, [], `${kind}: ${JSON.stringify(result.issues)}`);
    }
  });

  it('have real signatures from the example key', async () => {
    const manifest = examples.find((example) => example.kind === 'manifest')?.value;
    const history = trustOnFirstUse(manifest, { now: '2026-10-13T00:00:00Z' });
    for (const { value } of examples.filter((example) => example.kind === 'activity')) {
      assert.deepEqual(await verifyActivity(history, value, { source: 'origin', delivery: false }), { ok: true }, value.id);
    }
  });
});
