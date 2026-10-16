// The island service's tables. The service migrates itself: the first call
// in a fresh isolate checks the version and applies what is missing, in one
// transaction per version. Statements are idempotent, so two isolates doing
// it at once is harmless. The same SQL runs on D1 and on SQLite.

export const MIGRATIONS = Object.freeze([
  {
    version: 1,
    statements: [
      // Every other island this one has met.
      `CREATE TABLE IF NOT EXISTS islands (
        origin TEXT PRIMARY KEY,
        name TEXT,
        manifest TEXT,
        manifest_at INTEGER,
        history TEXT,
        first_seen INTEGER NOT NULL,
        following INTEGER NOT NULL DEFAULT 0,
        follower INTEGER NOT NULL DEFAULT 0,
        allowed INTEGER NOT NULL DEFAULT 0,
        blocked INTEGER NOT NULL DEFAULT 0,
        friends TEXT,
        friends_at INTEGER,
        poll TEXT
      ) STRICT`,
      // Directed activities this island accepted.
      `CREATE TABLE IF NOT EXISTS received (
        actor TEXT NOT NULL,
        id TEXT NOT NULL,
        type TEXT NOT NULL,
        folder TEXT NOT NULL,
        received INTEGER NOT NULL,
        read INTEGER NOT NULL DEFAULT 0,
        activity TEXT NOT NULL,
        PRIMARY KEY (actor, id)
      ) STRICT`,
      'CREATE INDEX IF NOT EXISTS received_by_folder ON received (folder, received DESC)',
      // Accepted (actor, id) pairs, kept 7 days against replays. `claim` is the
      // request that accepted it: the inbox claims a pair and its rate quota
      // in one conditional write, and every other write of that delivery
      // happens only if the claim is its own (src/inbox.js).
      'CREATE TABLE IF NOT EXISTS seen (actor TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, claim TEXT, PRIMARY KEY (actor, id)) STRICT',
      // Accepted deliveries per sender and per registrable domain, by hour.
      'CREATE TABLE IF NOT EXISTS rate (key TEXT NOT NULL, hour INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (key, hour)) STRICT',
      // Directed activities this island sent, one recipient each, with delivery state.
      `CREATE TABLE IF NOT EXISTS sent (
        id TEXT PRIMARY KEY,
        recipient TEXT NOT NULL,
        type TEXT NOT NULL,
        activity TEXT NOT NULL,
        created INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER,
        last_error TEXT
      ) STRICT`,
      'CREATE INDEX IF NOT EXISTS sent_due ON sent (status, next_at)',
      // Public activities read from followed islands, one row per activity id.
      // `published` is kept as UTC (toISOString), so text order is time order.
      `CREATE TABLE IF NOT EXISTS feed (
        actor TEXT NOT NULL,
        id TEXT NOT NULL,
        version TEXT NOT NULL,
        published TEXT NOT NULL,
        activity TEXT NOT NULL,
        PRIMARY KEY (actor, id)
      ) STRICT`,
      'CREATE INDEX IF NOT EXISTS feed_by_time ON feed (published DESC)',
      // Valid withdrawals (protocol "撤回与修改的归属"), keyed by withdrawer and
      // target id. `deleted` is the withdrawal's time in milliseconds (times
      // are compared as instants, never as RFC 3339 text). A post is only
      // taken again in a version later than that, so old signed copies cannot
      // bring it back.
      `CREATE TABLE IF NOT EXISTS tombstones (
        actor TEXT NOT NULL,
        target TEXT NOT NULL,
        deleted INTEGER NOT NULL,
        version TEXT NOT NULL,
        PRIMARY KEY (actor, target)
      ) STRICT`,
      // Outbox items that failed verification, by the SHA-256 of the whole
      // item and the key history they were checked against, so a scan does
      // not spend every run on the same bad items. Any change to the item
      // or to the history checks it again; rows expire after 30 days.
      `CREATE TABLE IF NOT EXISTS rejected (
        actor TEXT NOT NULL,
        item TEXT NOT NULL,
        history TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (actor, item, history)
      ) STRICT`,
      // The outbox pages of followed islands as last read: ETag, next page
      // and the items, each as canonical JSON, so a scan can continue across
      // runs, reuse 304 pages and check the publisher's snapshot digest.
      `CREATE TABLE IF NOT EXISTS pages (
        actor TEXT NOT NULL,
        url TEXT NOT NULL,
        etag TEXT,
        next TEXT,
        items TEXT NOT NULL,
        fetched INTEGER NOT NULL,
        PRIMARY KEY (actor, url)
      ) STRICT`,
      // Local notification events (never sent to other islands).
      `CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        at INTEGER NOT NULL,
        mode TEXT NOT NULL,
        data TEXT NOT NULL,
        sent INTEGER
      ) STRICT`,
      'CREATE INDEX IF NOT EXISTS events_pending ON events (sent, mode)',
      // Tokens for the owner's own AI: only their SHA-256 is stored.
      'CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, scope TEXT NOT NULL, label TEXT NOT NULL, created INTEGER NOT NULL, revoked INTEGER) STRICT',
      // Drafts made with a "draft" token, waiting for the owner.
      'CREATE TABLE IF NOT EXISTS drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL, by TEXT NOT NULL) STRICT',
      // Small bits of service state, such as the date of the last digest.
      'CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT',
    ],
  },
]);

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/**
 * Brings the tables up to date. Costs one store call when nothing is missing.
 * @param {import('./store-d1.js').Store} store
 * @returns {Promise<number>} the version before migrating
 */
export async function migrate(store) {
  const [, rows] = await store.batch([
    ['CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT'],
    ["SELECT value FROM meta WHERE key = 'schema'"],
  ]);
  const current = Number(rows[0]?.value ?? 0);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await store.batch([
      ...migration.statements.map((sql) => /** @type {[string]} */ ([sql])),
      [
        "INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE CAST(meta.value AS INTEGER) < CAST(excluded.value AS INTEGER)",
        [String(migration.version)],
      ],
    ]);
  }
  return current;
}
