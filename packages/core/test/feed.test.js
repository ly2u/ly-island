import assert from 'node:assert/strict';
import { test } from 'node:test';

import { attributeOf, childElements, parseXml, textOf } from '../../../tools/xml/xml.mjs';
import { absoluteLinks, buildFeed, escapeXml, FEED_ITEMS } from '../src/index.js';
import { config, ORIGIN, records } from './helpers.js';

test('a well-formed RSS feed with summaries and full text', () => {
  const list = records([
    { title: 'A & B <桥>', summary: '摘要', html: '<p>正文 <a href="/records/r2/">链接</a> <img src="/img/a.png" alt=""></p>', tags: ['桥', 'BIM'] },
    { kind: 'note', title: undefined, date: '2026-10-02', html: '<p>一句话</p>' },
    { date: '2026-10-03', withdrawn: '2026-10-04' },
  ]);
  const xml = buildFeed({ config: config(), records: list });
  const root = parseXml(xml);
  assert.equal(attributeOf(root, 'version'), '2.0');
  const channel = childElements(root, 'channel')[0];
  const items = childElements(channel, 'item');
  assert.equal(items.length, 2);
  const [note, article] = items;
  assert.equal(textOf(childElements(note, 'title')[0]), '一句话');
  assert.equal(textOf(childElements(note, 'description')[0]), '一句话');
  assert.equal(textOf(childElements(article, 'title')[0]), 'A & B <桥>');
  assert.equal(textOf(childElements(article, 'link')[0]), `${ORIGIN}/records/r1/`);
  assert.equal(textOf(childElements(article, 'pubDate')[0]), 'Wed, 30 Sep 2026 16:00:00 GMT'); // 10-01 00:00 in Asia/Shanghai
  const encoded = article.children.find((child) => typeof child !== 'string' && child.local === 'encoded');
  assert.equal(typeof encoded === 'object' && encoded.namespace, 'http://purl.org/rss/1.0/modules/content/');
  assert.match(String(typeof encoded === 'object' && textOf(encoded)), /href="https:\/\/example\.org\/records\/r2\/".*src="https:\/\/example\.org\/img\/a\.png"/);
  assert.deepEqual(childElements(article, 'category').map(textOf), ['桥', 'BIM']);
});

test('at most the newest 50 records', () => {
  const list = records(Array.from({ length: FEED_ITEMS + 5 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000) })));
  const items = childElements(childElements(parseXml(buildFeed({ config: config(), records: list })), 'channel')[0], 'item');
  assert.equal(items.length, FEED_ITEMS);
  assert.equal(textOf(childElements(items[0], 'link')[0]), `${ORIGIN}/records/r55/`);
});

test('escaping drops characters XML cannot hold', () => {
  assert.equal(escapeXml('a\u0001b￾<&>"\''), 'ab&lt;&amp;&gt;&quot;&apos;');
  assert.equal(absoluteLinks('<a href="//cdn.example/x">x</a><a href=\'/y\'>y</a>', ORIGIN), `<a href="//cdn.example/x">x</a><a href='${ORIGIN}/y'>y</a>`);
});
