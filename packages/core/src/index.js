// Build-time core for an island. See docs/extensions.md and site/README.md.

export { addDays, dateTime, dayNumber, isCalendarDate, isoWeek, isTimeZone, localDate, weekNumber } from './dates.js';
export { excerpt, normalizeRecords, plainText, publicRecords, RECORD_KINDS, RecordError, SLUG } from './records.js';
export { ACTIVE_WEEKS_KEPT, recordStats } from './stats.js';
export { ConfigError, DEFAULT_COLORS, islandConfig, islandSigner, TEST_ORIGIN, TEST_SEED } from './config.js';
export { buildIsland, DocumentError, newestRecordTime, OUTBOX_PAGE_SIZE, outboxPages } from './documents.js';
export { absoluteLinks, buildFeed, escapeXml, FEED_ITEMS } from './feed.js';
export { buildRobots, READING_CRAWLERS, TRAINING_CRAWLERS } from './robots.js';
export { CAPS, hash32, islandScene, random, shade, VIEW } from './scene.js';
export { DEFAULT_RULES, defaultRules, mergeLedger, presentStats, RULES, rulesFor } from './growth/index.js';
