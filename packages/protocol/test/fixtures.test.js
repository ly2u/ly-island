// Runs the shared fixtures (fixtures/cases.json) through the protocol core.
// The same fixtures are checked against the JSON Schemas by
// scripts/check_schemas.py, so the two implementations cannot drift apart.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { validateActivity } from '../src/activity.js';
import { validateFriends, validateKeyLog, validateManifest, validateOutbox } from '../src/documents.js';
import { isHttpsOrigin, keyIdOrigin, parseHttpsUrl } from '../src/util.js';

const { cases } = JSON.parse(readFileSync(new URL('../fixtures/cases.json', import.meta.url), 'utf8'));
const addresses = JSON.parse(readFileSync(new URL('../fixtures/addresses.json', import.meta.url), 'utf8')).cases;

describe('shared address syntax', () => {
  for (const { value, origin, url, keyId, note } of addresses) {
    it(`${note}: ${JSON.stringify(value).slice(0, 60)}`, () => {
      assert.equal(isHttpsOrigin(value), origin, 'origin');
      assert.equal(parseHttpsUrl(value) !== null, url, 'url');
      assert.equal(keyIdOrigin(value) !== null, keyId, 'keyId');
    });
  }
});

/**
 * All issue codes the protocol core reports for a case.
 * @param {{ kind: string, data: unknown, context?: { fetchedOrigin?: string } }} testCase
 * @returns {string[]}
 */
export function issueCodes({ kind, data, context = {} }) {
  switch (kind) {
    case 'activity':
      return validateActivity(data).issues.map((issue) => issue.code);
    case 'manifest':
      return validateManifest(data, context).issues.map((issue) => issue.code);
    case 'outbox': {
      const result = validateOutbox(data);
      return [...result.issues, ...result.items.flatMap((item) => item.issues)].map((issue) => issue.code);
    }
    case 'friends':
      return validateFriends(data).issues.map((issue) => issue.code);
    case 'keylog':
      return validateKeyLog(data).issues.map((issue) => issue.code);
    default:
      throw new Error(`unknown fixture kind ${kind}`);
  }
}

describe('shared fixtures', () => {
  it('has both valid and invalid cases for every kind', () => {
    const kinds = new Set(cases.map((/** @type {{ kind: string }} */ c) => c.kind));
    for (const kind of kinds) {
      assert.ok(cases.some((/** @type {any} */ c) => c.kind === kind && c.expect === 'valid'), kind);
      assert.ok(cases.some((/** @type {any} */ c) => c.kind === kind && c.expect === 'invalid'), kind);
    }
  });

  for (const testCase of cases) {
    it(`${testCase.kind}: ${testCase.name}`, () => {
      const codes = issueCodes(testCase);
      if (testCase.expect === 'valid') assert.deepEqual(codes, []);
      else assert.ok(codes.includes(testCase.code), `expected ${testCase.code}, got ${JSON.stringify(codes)}`);
    });
  }
});
