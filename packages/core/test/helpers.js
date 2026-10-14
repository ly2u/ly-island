// Shared test data. The seed is the public test key: never for a real island.

import { islandConfig, islandSigner, normalizeRecords } from '../src/index.js';

export const ORIGIN = 'https://example.org';

export function config(overrides = {}) {
  return islandConfig({ origin: ORIGIN, name: '测试岛', summary: '测试用。', language: ['zh-CN'], timeZone: 'Asia/Shanghai', ...overrides });
}

export function signer() {
  return islandSigner({ ISLAND_ALLOW_TEST_KEY: '1' }, { origin: ORIGIN, keyName: 'k1' });
}

/** @param {Partial<import('../src/records.js').RecordInput>[]} list */
export function records(list) {
  return normalizeRecords(
    list.map((item, i) => ({ slug: `r${i + 1}`, kind: 'article', title: `记录 ${i + 1}`, date: '2026-10-01', html: '<p>正文</p>', ...item })),
    { origin: ORIGIN, timeZone: 'Asia/Shanghai', language: 'zh-CN' },
  );
}
