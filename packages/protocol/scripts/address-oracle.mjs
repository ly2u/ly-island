// Reads a JSON array of strings on stdin and prints, for each, what the
// protocol core says: [origin, url, keyId]. Used by check_schemas.py to
// compare the JavaScript address rules with the JSON Schema patterns.

import { isHttpsOrigin, keyIdOrigin, parseHttpsUrl } from '../src/util.js';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const values = JSON.parse(input);
const results = values.map((/** @type {string} */ value) => [
  isHttpsOrigin(value),
  parseHttpsUrl(value) !== null,
  keyIdOrigin(value) !== null,
]);
process.stdout.write(JSON.stringify(results));
