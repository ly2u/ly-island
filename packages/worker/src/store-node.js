// Store on SQLite through node:sqlite: for tests, and later for self-hosting.
// Same SQL as D1 (which is SQLite).

import { DatabaseSync } from 'node:sqlite';

/** Statements that return rows. @param {string} sql */
const returnsRows = (sql) => /^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql);

/** @param {string} [path] @returns {import('./store-d1.js').Store & { close(): void }} */
export function sqliteStore(path = ':memory:') {
  const db = new DatabaseSync(path);
  const exec = (/** @type {string} */ sql, /** @type {unknown[]} */ params) => {
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
