// Reads the island's settings and data files. Paths are relative to the site
// folder, which is the working directory of every npm script here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { islandConfig } from '../../../packages/core/src/config.js';

export const THEMES = Object.freeze(['isometric', 'text']);

/** @param {string} path relative to the site folder */
export function readJson(path) {
  const full = join(process.env.ISLAND_SITE_ROOT ?? process.cwd(), path);
  try {
    return JSON.parse(readFileSync(full, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${path}: ${/** @type {Error} */ (error).message}`);
  }
}

export function loadConfig(env = process.env) {
  return islandConfig(readJson('island.config.json'), env, { themes: THEMES });
}
