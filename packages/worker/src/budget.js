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
 * @returns {{ take(count?: number): void, has(count?: number): boolean, hold(count: number): () => void,
 *   readonly used: number, readonly limit: number }}
 */
export function budget(limit) {
  let used = 0;
  let held = 0;
  return {
    /** Spends from what is not held. */
    take(count = 1) {
      if (used + held + count > limit) throw new BudgetExceeded();
      used += count;
    },
    has(count = 1) {
      return used + held + count <= limit;
    },
    /**
     * Keeps `count` aside, for example for the write that saves a run's
     * progress, so nothing before it can spend them. Returns the release.
     */
    hold(count) {
      if (used + held + count > limit) throw new BudgetExceeded();
      held += count;
      let released = false;
      return () => {
        if (!released) held -= count;
        released = true;
      };
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
