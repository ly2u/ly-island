// The island's settings (site/island.config.json) and its signing key.

import {
  encodeBase64url,
  importPrivateSeed,
  isProtocolHost,
  publicKeyOf,
} from '../../protocol/src/index.js';
import { isTimeZone } from './dates.js';
import { DEFAULT_RULES } from './growth/index.js';

export const TEST_ORIGIN = 'https://example.org';
/** The public test seed (32 bytes of 0x11) used by the docs and tests. Never for a real island. */
export const TEST_SEED = '11'.repeat(32);
export const DEFAULT_COLORS = Object.freeze(['#6fa8dc', '#f6b26b']);
const KEY_NAME = /^[A-Za-z0-9._-]{1,64}$/;
const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

export class ConfigError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`island.config.json has problems:\n- ${problems.join('\n- ')}`);
    this.problems = problems;
  }
}

/**
 * @typedef {object} IslandConfig
 * @property {string} origin
 * @property {string} name
 * @property {string} [summary]
 * @property {string[]} language
 * @property {string} timeZone
 * @property {string} theme
 * @property {{ seed: string, colors: string[] }} appearance
 * @property {{ rules: string, config: Record<string, unknown> }} growth
 * @property {boolean} discoverable
 * @property {{ read: boolean, train: boolean }} ai
 * @property {string} keyName
 */

/** @param {unknown} value */
function isOrigin(value) {
  if (typeof value !== 'string') return false;
  const match = /^https:\/\/([^/?#:@]+)$/.exec(value);
  return match !== null && isProtocolHost(match[1]);
}

/**
 * Checks the settings and applies environment overrides:
 * ISLAND_ORIGIN (the deployed address) and ISLAND_THEME.
 * @param {any} raw @param {Record<string, string | undefined>} [env]
 * @param {{ themes?: readonly string[] }} [options]
 * @returns {IslandConfig}
 */
export function islandConfig(raw, env = {}, { themes } = {}) {
  /** @type {string[]} */
  const problems = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError(['the file must hold a JSON object']);
  const known = ['$comment', 'origin', 'name', 'summary', 'language', 'timeZone', 'theme', 'appearance', 'growth', 'discoverable', 'ai', 'keyName'];
  for (const key of Object.keys(raw)) if (!known.includes(key)) problems.push(`unknown setting ${key}`);

  const origin = env.ISLAND_ORIGIN || raw.origin;
  if (!isOrigin(origin)) {
    problems.push('origin must be the https address of the island with a lowercase host name and nothing after it, e.g. https://example.org');
  }
  const chars = (/** @type {unknown} */ value) => (typeof value === 'string' ? Array.from(value).length : 0);
  if (typeof raw.name !== 'string' || chars(raw.name) < 1 || chars(raw.name) > 100) problems.push('name must be 1 to 100 characters');
  if (raw.summary !== undefined && (typeof raw.summary !== 'string' || chars(raw.summary) > 1000)) problems.push('summary must be at most 1000 characters');
  const language = raw.language ?? ['en'];
  if (!Array.isArray(language) || language.length < 1 || language.length > 8 || !language.every((tag) => typeof tag === 'string' && LANGUAGE.test(tag))) {
    problems.push('language must be a list of 1 to 8 language tags, e.g. ["zh-CN", "en"]');
  }
  const timeZone = raw.timeZone ?? 'UTC';
  if (typeof timeZone !== 'string' || !isTimeZone(timeZone)) problems.push('timeZone must be an IANA time zone, e.g. Asia/Shanghai');
  const theme = env.ISLAND_THEME || raw.theme || (themes ? themes[0] : 'isometric');
  if (typeof theme !== 'string' || (themes && !themes.includes(theme))) problems.push(`theme must be one of ${(themes ?? []).join(', ')}`);

  const appearance = raw.appearance ?? {};
  const seed = appearance.seed ?? (typeof origin === 'string' ? origin : 'island');
  if (typeof seed !== 'string' || seed.length < 1 || seed.length > 64) problems.push('appearance.seed must be 1 to 64 characters');
  const colors = appearance.colors ?? [...DEFAULT_COLORS];
  if (!Array.isArray(colors) || colors.length < 1 || colors.length > 8 || !colors.every((c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c))) {
    problems.push('appearance.colors must be 1 to 8 colors like "#6fa8dc"');
  }

  const growth = raw.growth ?? {};
  const rules = growth.rules ?? DEFAULT_RULES;
  if (typeof rules !== 'string') problems.push('growth.rules must name the rules, e.g. default@0');
  const growthConfig = growth.config ?? {};
  if (growthConfig === null || typeof growthConfig !== 'object' || Array.isArray(growthConfig)) problems.push('growth.config must be an object');

  const discoverable = raw.discoverable ?? false;
  if (typeof discoverable !== 'boolean') problems.push('discoverable must be true or false');
  const ai = raw.ai ?? { read: true, train: false };
  if (typeof ai?.read !== 'boolean' || typeof ai?.train !== 'boolean') problems.push('ai.read and ai.train must be true or false');
  const keyName = raw.keyName ?? 'k1';
  if (typeof keyName !== 'string' || !KEY_NAME.test(keyName)) problems.push('keyName must be 1 to 64 letters, digits, ".", "_" or "-"');

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    origin,
    name: raw.name,
    ...(raw.summary ? { summary: raw.summary } : {}),
    language,
    timeZone,
    theme,
    appearance: { seed, colors: colors.map((/** @type {string} */ c) => c.toLowerCase()) },
    growth: { rules, config: growthConfig },
    discoverable,
    ai: { read: ai.read, train: ai.train },
    keyName,
  };
}

/** @param {string} hex */
function fromHex(hex) {
  return Uint8Array.from((hex.match(/../g) ?? []).map((byte) => parseInt(byte, 16)));
}

/**
 * The signing key for public activities, from ISLAND_SIGNING_KEY (64 hex
 * characters: the Ed25519 seed). Without it, the public test key is used only
 * for the dev server, or when ISLAND_ALLOW_TEST_KEY=1 and the island is the
 * test origin https://example.org. The seed itself is never returned.
 * @param {Record<string, string | undefined>} env
 * @param {{ origin: string, keyName: string, dev?: boolean }} options
 */
export async function islandSigner(env, { origin, keyName, dev = false }) {
  const given = env.ISLAND_SIGNING_KEY?.trim().toLowerCase();
  const testAllowed = dev || (env.ISLAND_ALLOW_TEST_KEY === '1' && origin === TEST_ORIGIN);
  let seed = given;
  if (seed === undefined || seed === '') {
    if (!testAllowed) {
      throw new Error(
        'ISLAND_SIGNING_KEY is not set. Run `npm run keygen` once, keep the printed key safe, and set it as a build secret ' +
          '(for Cloudflare: Workers Builds, Settings, Build, Variables and secrets). See site/README.md.',
      );
    }
    seed = TEST_SEED;
  }
  if (!/^[0-9a-f]{64}$/.test(seed)) throw new Error('ISLAND_SIGNING_KEY must be 64 hexadecimal characters');
  if (seed === TEST_SEED && !testAllowed) throw new Error('ISLAND_SIGNING_KEY is the public test key; generate your own with `npm run keygen`');
  const privateKey = await importPrivateSeed(fromHex(seed));
  return {
    keyId: `${origin}#${keyName}`,
    privateKey,
    publicKey: encodeBase64url(await publicKeyOf(privateKey)),
    test: seed === TEST_SEED,
  };
}
