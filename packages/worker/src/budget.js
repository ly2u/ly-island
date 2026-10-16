// Subrequests per invocation. On the Cloudflare free plan every fetch and
// every D1 call counts toward 50 per invocation (redirect hops included), so
// both go through one budget. Stopping early is normal: unfinished work is
// saved and the next run continues.

export class BudgetExceeded extends Error {
  constructor() {
    super('subrequest budget used up for this run');
  }
}

/**
 * @param {number} limit
 * @returns {{ take(count?: number): void, has(count?: number): boolean, readonly used: number, readonly limit: number }}
 */
export function budget(limit) {
  let used = 0;
  return {
    take(count = 1) {
      if (used + count > limit) throw new BudgetExceeded();
      used += count;
    },
    has(count = 1) {
      return used + count <= limit;
    },
    get used() {
      return used;
    },
    limit,
  };
}

/**
 * A store whose every call is charged to the budget.
 * @param {import('./store-d1.js').Store} store
 * @param {ReturnType<typeof budget>} spend
 * @returns {import('./store-d1.js').Store}
 */
export function countedStore(store, spend) {
  return {
    all: (sql, params) => (spend.take(), store.all(sql, params)),
    first: (sql, params) => (spend.take(), store.first(sql, params)),
    run: (sql, params) => (spend.take(), store.run(sql, params)),
    batch: (statements) => (statements.length === 0 ? Promise.resolve([]) : (spend.take(), store.batch(statements))),
  };
}
