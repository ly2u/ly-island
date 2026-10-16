// Store on Cloudflare D1. Every call is one subrequest, a batch included.

/**
 * @typedef {object} Store
 * @property {(sql: string, params?: unknown[]) => Promise<Record<string, any>[]>} all
 * @property {(sql: string, params?: unknown[]) => Promise<Record<string, any> | null>} first
 * @property {(sql: string, params?: unknown[]) => Promise<{ changes: number }>} run
 * @property {(statements: [string, unknown[]?][]) => Promise<Record<string, any>[][]>} batch
 *   runs all statements in one transaction and returns the rows of each
 */

/** @param {any} db a D1Database binding @returns {Store} */
export function d1Store(db) {
  const prepare = (/** @type {string} */ sql, /** @type {unknown[]} */ params) => db.prepare(sql).bind(...params);
  return {
    async all(sql, params = []) {
      return (await prepare(sql, params).all()).results ?? [];
    },
    async first(sql, params = []) {
      return (await prepare(sql, params).first()) ?? null;
    },
    async run(sql, params = []) {
      const result = await prepare(sql, params).run();
      return { changes: result.meta?.changes ?? 0 };
    },
    async batch(statements) {
      if (statements.length === 0) return [];
      const results = await db.batch(statements.map(([sql, params = []]) => prepare(sql, params)));
      return results.map((/** @type {any} */ result) => result.results ?? []);
    },
  };
}
