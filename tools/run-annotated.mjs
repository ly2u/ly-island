// Runs a command and, when it fails on GitHub Actions, repeats the end of its
// output as an error annotation (readable through the API even when the logs
// are not).
//
//   node tools/run-annotated.mjs <title> -- <command> [args...]

import { spawn } from 'node:child_process';

const split = process.argv.indexOf('--');
const title = process.argv[2];
const [command, ...args] = process.argv.slice(split + 1);
if (split === -1 || !title || !command) throw new Error('usage: run-annotated.mjs <title> -- <command> [args...]');

/** @type {string[]} */
let tail = [];
const child = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
for (const [stream, out] of /** @type {const} */ ([[child.stdout, process.stdout], [child.stderr, process.stderr]])) {
  stream.on('data', (chunk) => {
    out.write(chunk);
    tail.push(...chunk.toString('utf8').split('\n'));
    if (tail.length > 600) tail = tail.slice(-300);
  });
}
child.on('close', (code) => {
  if (code !== 0 && process.env.GITHUB_ACTIONS) {
    const text = tail.filter((line) => line.trim() !== '').slice(-80).join('\n');
    const escaped = text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::error title=${title} failed (exit ${code})::${escaped.slice(-4000)}`);
  }
  process.exitCode = code ?? 1;
});
