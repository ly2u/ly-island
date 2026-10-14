import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decode, encode, isBase64urlOfLength } from '../src/base64url.js';
import { CanonicalizationError, canonicalize } from '../src/canonicalize.js';

describe('base64url', () => {
  it('round-trips bytes without padding', () => {
    for (const length of [0, 1, 2, 3, 31, 32, 64]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff);
      const text = encode(bytes);
      assert.doesNotMatch(text, /[=+/]/);
      assert.deepEqual(decode(text), bytes);
    }
  });

  it('refuses padding, other alphabets and non-canonical trailing bits', () => {
    assert.throws(() => decode('AA=='));
    assert.throws(() => decode('AA+/'));
    assert.throws(() => decode('A'));
    // "AB" decodes to one byte, but its canonical spelling is "AA".
    assert.throws(() => decode('AB'));
  });

  it('checks lengths', () => {
    assert.equal(isBase64urlOfLength('A'.repeat(86), 64), true);
    assert.equal(isBase64urlOfLength('A'.repeat(43), 32), true);
    assert.equal(isBase64urlOfLength('A'.repeat(43), 64), false);
    assert.equal(isBase64urlOfLength(42, 32), false);
  });
});

describe('canonicalize (RFC 8785)', () => {
  it('matches the RFC 8785 example for numbers, strings and literals', () => {
    const input = JSON.parse(
      '{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],' +
        ' "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",' +
        ' "literals": [null, true, false]}',
    );
    assert.equal(
      canonicalize(input),
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts member names by UTF-16 code units, as in RFC 8785', () => {
    const input = JSON.parse(
      '{"\\u20ac": 1, "\\r": 2, "\\ufb33": 3, "1": 4, "\\ud83d\\ude00": 5, "\\u0080": 6, "\\u00f6": 7}',
    );
    const names = [...canonicalize(input).matchAll(/"((?:[^"\\]|\\.)*)":/g)].map((match) => JSON.parse(`"${match[1]}"`));
    assert.deepEqual(names, ['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ']);
  });

  it('ignores the order members were written in', () => {
    assert.equal(canonicalize({ b: 1, a: { d: [1, 2], c: null } }), canonicalize({ a: { c: null, d: [1, 2] }, b: 1 }));
  });

  it('refuses data that is not I-JSON', () => {
    const cases = [
      [NaN, 'not-finite'],
      [Infinity, 'not-finite'],
      ['\ud800', 'lone-surrogate'],
      [{ ['\udc00']: 1 }, 'lone-surrogate'],
      [undefined, 'not-json'],
      [{ a: undefined }, 'not-json'],
      [10n, 'not-json'],
      [new Date(0), 'not-plain-object'],
      // eslint-disable-next-line no-sparse-arrays
      [[1, , 2], 'sparse-array'],
    ];
    for (const [value, code] of cases) {
      assert.throws(() => canonicalize(value), (error) => error instanceof CanonicalizationError && error.code === code);
    }
  });

  it('refuses very deep nesting', () => {
    let value = {};
    for (let i = 0; i < 40; i += 1) value = { v: value };
    assert.throws(() => canonicalize(value), { code: 'too-deep' });
  });
});
