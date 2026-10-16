// A small strict XML 1.0 parser with Namespaces in XML 1.0, enough to check
// generated feeds without adding a dependency. It rejects anything that is not
// well-formed and namespace-well-formed, including unbound prefixes.
//
// Deliberately stricter than XML, and rejected:
// - document type declarations (and so any entity other than the five predefined ones);
// - encodings other than UTF-8, and versions other than 1.x;
// - element, attribute and instruction names outside ASCII. Feeds never need them,
//   and XML editions disagree on which other characters names may use.
// Spike code: compared against Python's expat by xml-oracle.py.

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const MAX_DEPTH = 256;

const NCNAME = '[A-Za-z_][A-Za-z0-9._-]*';
const QNAME = new RegExp(`${NCNAME}(?::${NCNAME})?`, 'y');
const PI_TARGET = new RegExp(NCNAME, 'y');
// Any character some XML edition allows in names, used only to give the clear "ASCII" error.
const WIDE_NAME_CHAR = /[·À-ÖØ-öø-ͽͿ-῿‌‍‿⁀⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�\u{10000}-\u{EFFFF}]/u;
export const NON_ASCII_NAME = 'non-ASCII names are not supported';
export const UNSUPPORTED_VERSION = 'only XML version 1.x is supported';
const WHITESPACE = /[\t\n\r ]*/y;
const INVALID_CHAR = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/u;
const DECLARATION =
  /<\?xml[\t\n\r ]+version[\t\n\r ]*=[\t\n\r ]*(["'])([A-Za-z0-9_.:-]*)\1(?:[\t\n\r ]+encoding[\t\n\r ]*=[\t\n\r ]*(["'])([A-Za-z][A-Za-z0-9._-]*)\3)?(?:[\t\n\r ]+standalone[\t\n\r ]*=[\t\n\r ]*(["'])(?:yes|no)\5)?[\t\n\r ]*\?>/y;
const PREDEFINED = { lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' };

export class XmlError extends Error {}

/**
 * @typedef {{ type: 'element', name: string, prefix: string | null, local: string, namespace: string | null,
 *   attributes: { name: string, namespace: string | null, local: string, value: string }[],
 *   children: (XmlElement | string)[] }} XmlElement
 */

/** @param {number} cp */
function isXmlChar(cp) {
  return (
    cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) ||
    (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff)
  );
}

/**
 * Parses a whole document from UTF-8 bytes or a string and returns the root element.
 * @param {Uint8Array | string} input
 * @returns {XmlElement}
 */
export function parseXml(input) {
  let text;
  if (typeof input === 'string') {
    text = input;
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(input);
    } catch {
      throw new XmlError('not valid UTF-8');
    }
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // End-of-line handling (XML 1.0 section 2.11) happens before parsing.
  return new Parser(text.replace(/\r\n?/g, '\n')).document();
}

class Parser {
  /** @param {string} s */
  constructor(s) {
    this.s = s;
    this.i = 0;
  }

  /** @param {string} message @param {number} [at] @returns {never} */
  fail(message, at = this.i) {
    const before = this.s.slice(0, at);
    const line = before.split('\n').length;
    const column = at - before.lastIndexOf('\n');
    throw new XmlError(`${message} (line ${line}, column ${column})`);
  }

  /** @param {RegExp} pattern */
  match(pattern) {
    pattern.lastIndex = this.i;
    const found = pattern.exec(this.s);
    if (!found) return null;
    this.i = pattern.lastIndex;
    return found;
  }

  skipWhitespace() {
    const start = this.i;
    this.match(WHITESPACE);
    return this.i > start;
  }

  document() {
    const bad = INVALID_CHAR.exec(this.s);
    if (bad) this.fail(`character U+${bad[0].codePointAt(0)?.toString(16).toUpperCase()} is not allowed in XML`, bad.index);
    if (this.s.startsWith('<?xml') && /[\t\n\r ?]/.test(this.s[5] ?? '')) {
      const declaration = this.match(DECLARATION);
      if (!declaration) this.fail('malformed XML declaration');
      if (!/^1\.[0-9]+$/.test(declaration[2])) this.fail(UNSUPPORTED_VERSION, 0);
      const encoding = declaration[4];
      if (encoding !== undefined && !/^utf-8$/i.test(encoding)) this.fail(`only UTF-8 is supported, not ${encoding}`, 0);
    }
    this.misc();
    if (this.s[this.i] !== '<') this.fail('expected the root element');
    const root = this.element(new Map([['xml', XML_NS]]), 1);
    this.misc();
    if (this.i < this.s.length) this.fail('content after the root element');
    return root;
  }

  /** Whitespace, comments and processing instructions outside the root element. */
  misc() {
    for (;;) {
      this.skipWhitespace();
      if (this.s.startsWith('<!--', this.i)) this.comment();
      else if (this.s.startsWith('<?', this.i)) this.instruction();
      else if (this.s.startsWith('<!DOCTYPE', this.i)) this.fail('document type declarations are not supported');
      else return;
    }
  }

  comment() {
    const end = this.s.indexOf('--', this.i + 4);
    if (end === -1) this.fail('unclosed comment');
    if (this.s[end + 2] !== '>') this.fail('"--" is not allowed inside a comment', end);
    this.i = end + 3;
  }

  instruction() {
    const start = this.i;
    this.i += 2;
    const target = this.name(PI_TARGET);
    if (!target) this.fail('malformed processing instruction');
    if (target[0].toLowerCase() === 'xml') this.fail('the XML declaration is only allowed at the very start', start);
    if (this.s[this.i] === ':') this.fail('processing instruction targets cannot contain ":"');
    if (!this.s.startsWith('?>', this.i) && !this.skipWhitespace()) this.fail('malformed processing instruction');
    const end = this.s.indexOf('?>', this.i);
    if (end === -1) this.fail('unclosed processing instruction', start);
    this.i = end + 2;
  }

  /** Matches an ASCII name, failing clearly when the name goes on outside ASCII. */
  name(/** @type {RegExp} */ pattern) {
    const found = this.match(pattern);
    const next = this.s.codePointAt(this.i) ?? 0;
    if (next > 0x7f && WIDE_NAME_CHAR.test(String.fromCodePoint(next))) this.fail(NON_ASCII_NAME);
    return found;
  }

  qname() {
    const found = this.name(QNAME);
    if (!found) this.fail('expected a name');
    if (this.s[this.i] === ':') this.fail('malformed qualified name');
    return found[0];
  }

  /**
   * Replaces character and predefined entity references.
   * @param {string} raw @param {number} at index of raw in the source
   */
  decode(raw, at) {
    let out = '';
    let from = 0;
    for (;;) {
      const amp = raw.indexOf('&', from);
      if (amp === -1) return out + raw.slice(from);
      out += raw.slice(from, amp);
      const semi = raw.indexOf(';', amp);
      if (semi === -1) this.fail('"&" must start a reference ending in ";"', at + amp);
      const name = raw.slice(amp + 1, semi);
      let value;
      if (/^#[0-9]+$/.test(name) || /^#x[0-9A-Fa-f]+$/.test(name)) {
        const digits = name[1] === 'x' ? name.slice(2) : name.slice(1);
        const cp = digits.length > 8 ? -1 : parseInt(digits, name[1] === 'x' ? 16 : 10);
        if (!isXmlChar(cp)) this.fail(`&${name}; is not an allowed character`, at + amp);
        value = String.fromCodePoint(cp);
      } else if (Object.hasOwn(PREDEFINED, name)) {
        value = PREDEFINED[/** @type {keyof typeof PREDEFINED} */ (name)];
      } else {
        this.fail(`undefined entity &${name};`, at + amp);
      }
      out += value;
      from = semi + 1;
    }
  }

  /**
   * @param {Map<string, string>} scope prefix -> namespace ('' for the default)
   * @param {number} depth
   * @returns {XmlElement}
   */
  element(scope, depth) {
    if (depth > MAX_DEPTH) this.fail('elements are nested too deeply');
    const start = this.i;
    this.i += 1;
    const name = this.qname();
    /** @type {{ name: string, value: string, at: number }[]} */
    const raw = [];
    let selfClosing = false;
    for (;;) {
      const spaced = this.skipWhitespace();
      if (this.s.startsWith('/>', this.i)) {
        this.i += 2;
        selfClosing = true;
        break;
      }
      if (this.s[this.i] === '>') {
        this.i += 1;
        break;
      }
      if (this.i >= this.s.length) this.fail(`unclosed start tag <${name}>`, start);
      if (!spaced) this.fail('expected whitespace before an attribute');
      const at = this.i;
      const attribute = this.qname();
      this.skipWhitespace();
      if (this.s[this.i] !== '=') this.fail(`expected "=" after ${attribute}`);
      this.i += 1;
      this.skipWhitespace();
      const quote = this.s[this.i];
      if (quote !== '"' && quote !== "'") this.fail('attribute values must be quoted');
      const end = this.s.indexOf(quote, this.i + 1);
      if (end === -1) this.fail('unclosed attribute value');
      const value = this.s.slice(this.i + 1, end);
      const lt = value.indexOf('<');
      if (lt !== -1) this.fail('"<" is not allowed in attribute values', this.i + 1 + lt);
      if (raw.some((other) => other.name === attribute)) this.fail(`duplicate attribute ${attribute}`, at);
      // Attribute-value normalization for CDATA attributes: literal whitespace becomes a space.
      raw.push({ name: attribute, value: this.decode(value.replace(/[\t\n]/g, ' '), this.i + 1), at });
      this.i = end + 1;
    }

    const inner = new Map(scope);
    for (const { name: attribute, value, at } of raw) {
      if (attribute === 'xmlns') {
        if (value === XML_NS || value === XMLNS_NS) this.fail(`${value} cannot be the default namespace`, at);
        inner.set('', value);
      } else if (attribute.startsWith('xmlns:')) {
        const prefix = attribute.slice(6);
        if (prefix === 'xmlns') this.fail('the xmlns prefix cannot be declared', at);
        if (value === '') this.fail(`prefix ${prefix} cannot be undeclared in XML 1.0`, at);
        if ((prefix === 'xml') !== (value === XML_NS)) this.fail(`prefix ${prefix} cannot be bound to ${value}`, at);
        if (value === XMLNS_NS) this.fail(`prefix ${prefix} cannot be bound to ${value}`, at);
        inner.set(prefix, value);
      }
    }

    const resolve = (/** @type {string} */ qualified, /** @type {boolean} */ isElement, /** @type {number} */ at) => {
      const colon = qualified.indexOf(':');
      if (colon === -1) {
        const namespace = isElement ? inner.get('') || null : null;
        return { prefix: null, local: qualified, namespace };
      }
      const prefix = qualified.slice(0, colon);
      const namespace = inner.get(prefix);
      if (namespace === undefined) this.fail(`unbound prefix ${prefix}`, at);
      return { prefix, local: qualified.slice(colon + 1), namespace };
    };

    const resolved = resolve(name, true, start + 1);
    /** @type {XmlElement['attributes']} */
    const attributes = [];
    const seen = new Set();
    for (const { name: attribute, value, at } of raw) {
      if (attribute === 'xmlns' || attribute.startsWith('xmlns:')) continue;
      const { local, namespace } = resolve(attribute, false, at);
      const key = `${namespace ?? ''} ${local}`;
      if (seen.has(key)) this.fail(`attribute ${attribute} repeats an expanded name`, at);
      seen.add(key);
      attributes.push({ name: attribute, namespace, local, value });
    }

    /** @type {XmlElement} */
    const element = { type: 'element', name, ...resolved, attributes, children: [] };
    if (selfClosing) return element;

    for (;;) {
      if (this.i >= this.s.length) this.fail(`unclosed element <${name}>`, start);
      if (this.s.startsWith('</', this.i)) {
        const at = this.i;
        this.i += 2;
        const closing = this.qname();
        if (closing !== name) this.fail(`</${closing}> does not close <${name}>`, at);
        this.skipWhitespace();
        if (this.s[this.i] !== '>') this.fail('malformed end tag');
        this.i += 1;
        return element;
      }
      if (this.s.startsWith('<!--', this.i)) {
        this.comment();
      } else if (this.s.startsWith('<![CDATA[', this.i)) {
        const end = this.s.indexOf(']]>', this.i + 9);
        if (end === -1) this.fail('unclosed CDATA section');
        element.children.push(this.s.slice(this.i + 9, end));
        this.i = end + 3;
      } else if (this.s.startsWith('<?', this.i)) {
        this.instruction();
      } else if (this.s.startsWith('<!', this.i)) {
        this.fail('markup declarations are not allowed here');
      } else if (this.s[this.i] === '<') {
        element.children.push(this.element(inner, depth + 1));
      } else {
        const next = this.s.indexOf('<', this.i);
        const end = next === -1 ? this.s.length : next;
        const chunk = this.s.slice(this.i, end);
        const marker = chunk.indexOf(']]>');
        if (marker !== -1) this.fail('"]]>" is not allowed in text', this.i + marker);
        element.children.push(this.decode(chunk, this.i));
        this.i = end;
      }
    }
  }
}

/**
 * Child elements with the given local name and no namespace.
 * @param {XmlElement} element @param {string} local
 */
export function childElements(element, local) {
  return element.children.filter(
    (child) => typeof child !== 'string' && child.namespace === null && child.local === local,
  );
}

/**
 * The text of an element that holds only text, or null when it has child elements.
 * @param {XmlElement} element
 */
export function textOf(element) {
  if (element.children.some((child) => typeof child !== 'string')) return null;
  return element.children.join('');
}

/** @param {XmlElement} element @param {string} name */
export function attributeOf(element, name) {
  return element.attributes.find((attribute) => attribute.namespace === null && attribute.local === name)?.value;
}
