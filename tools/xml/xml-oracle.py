"""Compares the strict XML checker in xml.mjs with Python's expat.

Generates random mutations of a few feed-like documents and checks that
xml.mjs accepts exactly what expat (with namespace processing, as used by
xml.etree.ElementTree) accepts. Exits with 1 on any disagreement or crash.

    python3 tools/xml/xml-oracle.py [count]

xml.mjs is deliberately stricter in a few ways (see its header). The generator
never produces document type declarations or other encodings; documents that
expat accepts but xml.mjs rejects for a non-ASCII name or a version other than
1.x are counted as intended, not as disagreements.
"""

import base64
import json
import random
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent

SEEDS = [
    # What a summary-only feed looks like.
    '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>示例岛</title>'
    '<description>静态生成器对比用的示例岛屿。</description><link>https://example.org/</link>'
    '<item><title>今天的一句话</title><link>https://example.org/notes/one-line/</link>'
    '<guid isPermaLink="true">https://example.org/notes/one-line/</guid>'
    '<description>一句话也算一次记录。</description><pubDate>Thu, 08 Oct 2026 00:00:00 GMT</pubDate>'
    '</item></channel></rss>',
    # The shape that failed review: content:encoded without its namespace.
    '<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"'
    ' xml:base="https://example.org/" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n'
    '    <item>\n      <description>摘要</description>\n'
    '      <content:encoded>&lt;p&gt;正文&lt;/p&gt;</content:encoded>\n    </item>\n  </channel>\n</rss>',
    # The same with the namespace declared, a stylesheet instruction and CDATA.
    '<?xml version="1.0" encoding="utf-8"?>\n<?xml-stylesheet href="s.xsl" type="text/xsl"?>\n'
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xml:base="https://example.org/">'
    '<channel><item><content:encoded><![CDATA[<p>hi]]></content:encoded></item></channel></rss>\n',
    # Default and prefixed namespaces, attributes, comments, references.
    '<a xmlns="urn:a" xmlns:b="urn:b"><b:c b:x="1" y=\'2\'/><!-- note --><?pi data?>'
    't&amp;&#x4E2D;&#20013;<d xmlns=""><e/></d></a>',
]

TOKENS = [
    '<', '>', '&', ';', '"', "'", '=', '/', ':', ' ', '\n', '\t', '-', '!', '?', '[', ']',
    '&amp;', '&lt;', '&foo;', '&#0;', '&#9;', '&#x41;', '&#xD800;', '&#x110000;', '&#99999999999;', '&#;',
    ']]>', '<![CDATA[x]]>', '<![CDATA[', '<!-- c -->', '<!-- a -- b -->', '<!--->', '<!---->', '-->',
    '<?pi x?>', '<?pi?>', '<?xml version="1.0"?>', '<?XML x?>', '<?a:b x?>', '<?xml-stylesheet x?>',
    '<a:b>', '</a:b>', '<x/>', '<x>', '</x>', '<p:x/>', '<:x/>', '<x:/>', '<a:b:c/>', '<xmlns:x/>', '<1x/>',
    ' xmlns:p="urn:p"', ' xmlns:p=""', ' xmlns=""', ' xmlns="urn:d"', ' p:a="1"', ' a="1"', " a='2'",
    ' a="1" a="2"', ' xmlns:p="urn:p" xmlns:q="urn:p" p:z="1" q:z="2"', ' xml:lang="en"',
    ' xmlns:xml="urn:x"', ' xmlns:xml="http://www.w3.org/XML/1998/namespace"', ' xmlns:xmlns="urn:x"',
    ' xmlns="http://www.w3.org/XML/1998/namespace"', ' xmlns:p="http://www.w3.org/2000/xmlns/"',
    ' a="<"', ' a="&#60;"', ' a=x', ' =', '\u0001', '\u000b', '\ufffe', '\uffff', '\u0085', '\u2028',
    'é', '中', '\U0001F30A', '\u00b7', '\u0300', '<\u00b7/>', '<_\u0300/>', '<é/>', '<中/>',
]


def mutate(rng: random.Random, text: str) -> bytes:
    for _ in range(rng.randint(1, 3)):
        choice = rng.random()
        at = rng.randint(0, len(text))
        if choice < 0.35:
            text = text[:at] + rng.choice(TOKENS) + text[at:]
        elif choice < 0.6:
            text = text[:at] + text[at + rng.randint(1, 6):]
        elif choice < 0.75 and len(text) > 2:
            start = rng.randint(0, len(text) - 1)
            text = text[:at] + text[start:start + rng.randint(1, 12)] + text[at:]
        elif choice < 0.9 and len(text) > 2:
            a, b = sorted(rng.sample(range(len(text)), 2))
            text = text[:a] + text[b] + text[a + 1:b] + text[a] + text[b + 1:]
        else:
            pass
    data = text.encode('utf-8', 'surrogatepass')
    if rng.random() < 0.05 and data:
        at = rng.randint(0, len(data) - 1)
        data = data[:at] + bytes([rng.choice([0x80, 0xC0, 0xED, 0xF5, 0xFF])]) + data[at:]
    return data


def expat_accepts(data: bytes) -> bool:
    try:
        ET.fromstring(data)
        return True
    except ET.ParseError:
        return False


INTENDED = ('non-ASCII names are not supported', 'only XML version 1.x is supported')

NODE = """
import { parseXml, XmlError } from %s;
let input = '';
for await (const chunk of process.stdin) input += chunk;
const verdicts = JSON.parse(input).map((b64) => {
  try { parseXml(Buffer.from(b64, 'base64')); return null; }
  catch (error) { if (error instanceof XmlError) return error.message; throw error; }
});
process.stdout.write(JSON.stringify(verdicts));
"""


def main() -> int:
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 4000
    rng = random.Random(20261014)
    docs = [seed.encode('utf-8') for seed in SEEDS]
    while len(docs) < count:
        data = mutate(rng, rng.choice(SEEDS))
        if b'<!DOCTYPE' in data or b'encoding=' in data and b'encoding="utf-8"' not in data.lower():
            continue
        docs.append(data)

    url = json.dumps((HERE / 'xml.mjs').as_uri())
    run = subprocess.run(
        ['node', '--input-type=module', '-e', NODE % url],
        input=json.dumps([base64.b64encode(doc).decode() for doc in docs]),
        capture_output=True, text=True, check=False,
    )
    if run.returncode != 0:
        print(run.stderr)
        print('xml.mjs crashed instead of reporting XmlError')
        return 1
    verdicts = json.loads(run.stdout)

    mismatches = []
    accepted = 0
    stricter = 0
    for doc, verdict in zip(docs, verdicts):
        ours = verdict is None
        theirs = expat_accepts(doc)
        accepted += theirs
        if ours == theirs:
            continue
        if theirs and verdict.startswith(INTENDED):
            stricter += 1
        else:
            mismatches.append((doc, verdict))
    print(f'{len(docs)} documents: expat accepts {accepted}, rejects {len(docs) - accepted}; '
          f'xml.mjs also rejects {stricter} on purpose; {len(mismatches)} disagreements')
    for doc, verdict in mismatches[:20]:
        print(f'  xml.mjs {"accepts" if verdict is None else "rejects (" + verdict + ")"}: {doc!r}')
    return 1 if mismatches else 0


if __name__ == '__main__':
    sys.exit(main())
