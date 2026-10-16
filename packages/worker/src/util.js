/** FNV-1a over UTF-16 code units: a stable spread, not a secret. @param {string} text */
export function hash32(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The cron schedule for an island: four runs an hour at minutes spread by
 * hash(origin), e.g. "7,22,37,52 * * * *" (protocol "频率与批次").
 * @param {string} origin
 */
export function cronFor(origin) {
  const minute = hash32(origin) % 15;
  return `${[0, 1, 2, 3].map((i) => minute + i * 15).join(',')} * * * *`;
}
