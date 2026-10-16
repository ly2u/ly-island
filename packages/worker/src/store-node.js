// Store on SQLite through node:sqlite: for tests, and later for self-hosting.
// Same SQL as D1 (which is SQLite).

import { DatabaseSync } from 'node:sqlite';

/** Statements that return rows. @param {string} sql */
const returnsRows = (sql) => /^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql);

// D1's limits, enforced here too so tests catch what D1 would refuse:
// https://developers.cloudflare.com/d1/platform/limits/
export const D1_LIMITS = Object.freeze({ boundParameters: 100, statementBytes: 100_000 });

/** @param {string} sql @param {unknown[]} params */
function checkD1Limits(sql, params) {
  if (params.length > D1_LIMITS.boundParameters) throw new Error(`too many SQL variables: ${params.length} (D1 allows ${D1_LIMITS.boundParameters})`);
  if (new TextEncoder().encode(sql).length > D1_LIMITS.statementBytes) throw new Error('SQL statement too long for D1');
}

/** @param {string} [path] @returns {import('./store-d1.js').Store & { close(): void }} */
export function sqliteStore(path = ':memory:') {
  const db = new DatabaseSync(path);
  const exec = (/** @type {string} */ sql, /** @type {unknown[]} */ params) => {
    checkD1Limits(sql, params);
    const statement = db.prepare(sql);
    return returnsRows(sql)
      ? statement.all(.../** @type {any[]} */ (params)).map((row) => ({ ...row }))
      : (statement.run(.../** @type {any[]} */ (params)), []);
  };
  return {
    async all(sql, params = []) {
      return exec(sql, params);
    },
    async first(sql, params = []) {
      return exec(sql, params)[0] ?? null;
    },
    async run(sql, params = []) {
      checkD1Limits(sql, params);
      const result = db.prepare(sql).run(.../** @type {any[]} */ (params));
      return { changes: Number(result.changes) };
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = statements.map(([sql, params = []]) => exec(sql, params));
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}
