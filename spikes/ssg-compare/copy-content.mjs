// Copies the example notes into a generator's input folder, replacing what was there.
// Eleventy reads its input from one folder; Astro reads the notes directly.
// SPIKE_CONTENT points both at another folder of notes (measure.mjs uses it
// to check that a note with bad front matter fails the build).

import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
if (!target) throw new Error('usage: node copy-content.mjs <target folder>');
const source = process.env.SPIKE_CONTENT
  ? resolve(process.env.SPIKE_CONTENT)
  : fileURLToPath(new URL('./content/', import.meta.url));
mkdirSync(target, { recursive: true });
for (const name of readdirSync(target)) {
  if (name.endsWith('.md')) rmSync(join(target, name));
}
for (const name of readdirSync(source)) {
  if (name.endsWith('.md')) copyFileSync(join(source, name), join(target, name));
}
