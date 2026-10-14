// Copies the shared example notes into a generator's input folder.
// Eleventy reads its input from one folder; Astro reads ../content directly.

import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const target = process.argv[2];
if (!target) throw new Error('usage: node copy-content.mjs <target folder>');
const source = new URL('./content/', import.meta.url);
mkdirSync(target, { recursive: true });
for (const name of readdirSync(source)) {
  if (name.endsWith('.md')) copyFileSync(new URL(name, source), join(target, name));
}
