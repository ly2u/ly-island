import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { childElements, NON_ASCII_NAME, parseXml, textOf, UNSUPPORTED_VERSION, XmlError } from './xml.mjs';

const rejects = (/** @type {string | Uint8Array} */ input, /** @type {RegExp} */ message) =>
  assert.throws(() => parseXml(input), (error) => error instanceof XmlError && message.test(error.message));

describe('well-formed documents', () => {
  test('a feed with namespaces, CDATA, references and comments', () => {
    const root = parseXml(
      '﻿<?xml version="1.0" encoding="utf-8"?>\n<?xml-stylesheet href="s.xsl"?>\n<!-- top -->\n' +
        '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xml:base="https://example.org/">' +
        '<channel><item><title>A &amp; B &#x4E2D;&#25991;</title><content:encoded><![CDATA[<p>x</p>]]></content:encoded></item></channel></rss>\n',
    );
    assert.equal(root.local, 'rss');
    const item = childElements(childElements(root, 'channel')[0], 'item')[0];
    assert.equal(textOf(childElements(item, 'title')[0]), 'A & B 中文');
    const encoded = item.children.find((child) => typeof child !== 'string' && child.local === 'encoded');
    assert.equal(typeof encoded === 'object' && encoded.namespace, 'http://purl.org/rss/1.0/modules/content/');
    assert.deepEqual(root.attributes.map((a) => [a.local, a.namespace]), [
      ['version', null],
      ['base', 'http://www.w3.org/XML/1998/namespace'],
    ]);
  });

  test('default namespaces apply to elements, not to attributes, and can be reset', () => {
    const root = parseXml('<a xmlns="urn:a" x="1"><b xmlns=""/></a>');
    assert.equal(root.namespace, 'urn:a');
    assert.equal(root.attributes[0].namespace, null);
    assert.equal(/** @type {any} */ (root.children[0]).namespace, null);
  });

  test('bytes are decoded as UTF-8 and line ends normalized', () => {
    const root = parseXml(new TextEncoder().encode('<a>一\r\n二\r三</a>'));
    assert.equal(textOf(root), '一\n二\n三');
  });
});

describe('rejected documents', () => {
  test('an unbound prefix, as in the Eleventy plugin feed', () => {
    rejects('<rss version="2.0">\n  <channel>\n    <content:encoded>x</content:encoded>\n  </channel>\n</rss>', /^unbound prefix content \(line 3, column 6\)$/);
    rejects('<a p:x="1"/>', /unbound prefix p/);
  });

  test('namespace declaration mistakes', () => {
    rejects('<a xmlns:p=""/>', /cannot be undeclared/);
    rejects('<a xmlns:xmlns="urn:x"/>', /xmlns prefix/);
    rejects('<a xmlns:xml="urn:x"/>', /cannot be bound/);
    rejects('<a xmlns:p="http://www.w3.org/XML/1998/namespace"/>', /cannot be bound/);
    rejects('<a xmlns="http://www.w3.org/2000/xmlns/"/>', /default namespace/);
    rejects('<a xmlns:p="urn:x" xmlns:q="urn:x" p:z="1" q:z="2"/>', /expanded name/);
    rejects('<a:b:c/>', /qualified name/);
  });

  test('structure mistakes', () => {
    rejects('<a><b></a></b>', /does not close/);
    rejects('<a/><b/>', /after the root/);
    rejects('text<a/>', /expected the root element/);
    rejects('<a>', /unclosed element/);
    rejects('<a x="1" x="2"/>', /duplicate attribute/);
    rejects('<a x="1"y="2"/>', /whitespace before an attribute/);
    rejects('<a x=1/>', /must be quoted/);
    rejects('<a x="<"/>', /not allowed in attribute values/);
  });

  test('text, reference and comment mistakes', () => {
    rejects('<a>]]></a>', /"\]\]>" is not allowed/);
    rejects('<a>&nbsp;</a>', /undefined entity &nbsp;/);
    rejects('<a>& b</a>', /must start a reference/);
    rejects('<a>&#0;</a>', /not an allowed character/);
    rejects('<a>&#xD800;</a>', /not an allowed character/);
    rejects('<a><!-- a -- b --></a>', /"--" is not allowed/);
    rejects('<a>\u0001</a>', /U\+1 is not allowed/);
    rejects('<a>￾</a>', /U\+FFFE is not allowed/);
  });

  test('declarations and unsupported features', () => {
    rejects(' <?xml version="1.0"?><a/>', /only allowed at the very start/);
    rejects('<?xml version="1.0" encoding="ISO-8859-1"?><a/>', /only UTF-8/);
    rejects('<?xml version="2.0"?><a/>', new RegExp(UNSUPPORTED_VERSION));
    rejects('<!DOCTYPE a><a/>', /document type declarations/);
    rejects('<é/>', new RegExp(NON_ASCII_NAME));
    rejects(new Uint8Array([0x3c, 0x61, 0x3e, 0xff, 0x3c, 0x2f, 0x61, 0x3e]), /not valid UTF-8/);
    rejects(`${'<a>'.repeat(300)}${'</a>'.repeat(300)}`, /nested too deeply/);
  });
});
