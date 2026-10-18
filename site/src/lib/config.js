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

/**
 * The island's settings: island.config.json, or the file named by
 * ISLAND_CONFIG (relative to the site folder), so one repository can build
 * a second island, such as a test island next to the real one.
 */
export function loadConfig(env = process.env) {
  return islandConfig(readJson(env.ISLAND_CONFIG || 'island.config.json'), env, { themes: THEMES });
}
