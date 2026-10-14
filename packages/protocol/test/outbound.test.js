import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildOutboundHeaders,
  checkOutboundHeaders,
  checkOutboundUrl,
  checkRedirect,
  checkResolvedAddresses,
  isForbiddenAddress,
  parseIPv6,
} from '../src/outbound.js';

/** @param {string} url @param {Parameters<typeof checkOutboundUrl>[1]} [options] */
function reason(url, options) {
  const result = checkOutboundUrl(url, options);
  return result.ok ? 'ok' : result.reason;
}

describe('outbound URLs', () => {
  it('allows plain https on public hosts', () => {
    assert.equal(reason('https://neighbor.example/island/inbox'), 'ok');
    assert.equal(reason('https://1.1.1.1/x'), 'ok');
    assert.equal(reason('https://[2606:4700:4700::1111]/x'), 'ok');
  });

  it('refuses other schemes, credentials and ports', () => {
    assert.equal(reason('http://neighbor.example/'), 'not-https');
    assert.equal(reason('file:///etc/passwd'), 'not-https');
    assert.equal(reason('https://user:pw@neighbor.example/'), 'credentials-in-url');
    assert.equal(reason('https://neighbor.example:8443/'), 'non-default-port');
    assert.equal(reason('https://neighbor.example:443/'), 'ok');
    assert.equal(reason('not a url'), 'invalid-url');
  });

  it('refuses private, loopback and reserved IPv4, in every spelling the URL parser accepts', () => {
    for (const host of [
      '127.0.0.1',
      '127.1',
      '0x7f.1',
      '2130706433',
      '0177.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '198.18.0.1',
      '192.0.2.10',
    ]) {
      assert.equal(reason(`https://${host}/x`), 'forbidden-address', host);
    }
    assert.equal(reason('https://172.32.0.1/x'), 'ok');
  });

  it('refuses non-global IPv6, including IPv4 hidden inside it', () => {
    for (const host of [
      '[::1]',
      '[::]',
      '[fc00::1]',
      '[fd12:3456::1]',
      '[fe80::1]',
      '[ff02::1]',
      '[::ffff:127.0.0.1]',
      '[::ffff:10.0.0.1]',
      '[64:ff9b::7f00:1]',
      '[2002:7f00:1::]',
      '[2001::1]',
      '[2001:db8::1]',
      '[100::1]',
    ]) {
      assert.equal(reason(`https://${host}/x`), 'forbidden-address', host);
    }
    assert.equal(reason('https://[64:ff9b::101:101]/x'), 'ok');
  });

  it('refuses local host names', () => {
    assert.equal(reason('https://localhost/'), 'forbidden-host');
    assert.equal(reason('https://admin.localhost/'), 'forbidden-host');
    assert.equal(reason('https://printer.local/'), 'forbidden-host');
    assert.equal(reason('https://db.internal/'), 'forbidden-host');
    assert.equal(reason('https://router.home.arpa/'), 'forbidden-host');
    assert.equal(reason('https://intranet/'), 'single-label-host');
    assert.equal(reason('https://neighbor.example./'), 'trailing-dot-host');
  });

  it('can require the same origin', () => {
    assert.equal(reason('https://neighbor.example/a', { sameOriginAs: 'https://neighbor.example' }), 'ok');
    assert.equal(reason('https://evil.example/a', { sameOriginAs: 'https://neighbor.example' }), 'cross-origin');
  });
});

describe('IP addresses', () => {
  it('parses IPv6 forms', () => {
    assert.deepEqual(parseIPv6('::'), [0, 0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(parseIPv6('[::1]'), [0, 0, 0, 0, 0, 0, 0, 1]);
    assert.deepEqual(parseIPv6('2001:db8::8:800:200c:417a'), [0x2001, 0xdb8, 0, 0, 0x8, 0x800, 0x200c, 0x417a]);
    assert.deepEqual(parseIPv6('::ffff:192.0.2.1'), [0, 0, 0, 0, 0, 0xffff, 0xc000, 0x201]);
    for (const bad of ['1::2::3', ':1::', '12345::', '1:2:3:4:5:6:7', 'fe80::1%eth0', '::ffff:999.0.0.1']) {
      assert.equal(parseIPv6(bad), null, bad);
    }
  });

  it('fails closed on anything it cannot parse', () => {
    assert.equal(isForbiddenAddress('not-an-ip'), true);
    assert.equal(isForbiddenAddress('010.0.0.1'), true);
    assert.equal(isForbiddenAddress('8.8.8.8'), false);
  });

  it('checks every resolved address before connecting (DNS rebinding)', () => {
    assert.deepEqual(checkResolvedAddresses(['93.184.215.14']), { ok: true });
    assert.deepEqual(checkResolvedAddresses(['93.184.215.14', '127.0.0.1']), { ok: false, reason: 'forbidden-address' });
    assert.deepEqual(checkResolvedAddresses([]), { ok: false, reason: 'no-address' });
  });
});

describe('redirects', () => {
  const from = 'https://neighbor.example/island/outbox.json';

  it('never follows a redirect for an inbox POST', () => {
    assert.deepEqual(checkRedirect({ method: 'POST', from, location: '/island/inbox2', hops: 0 }), {
      ok: false,
      reason: 'redirect-not-followed',
    });
  });

  it('follows GET redirects only on the same origin, re-checking each hop', () => {
    assert.equal(checkRedirect({ method: 'GET', from, location: '/island/outbox-2.json', hops: 0 }).ok, true);
    assert.deepEqual(checkRedirect({ method: 'GET', from, location: 'https://127.0.0.1/', hops: 0 }), {
      ok: false,
      reason: 'forbidden-address',
    });
    assert.deepEqual(checkRedirect({ method: 'GET', from, location: 'https://other.example/', hops: 0 }), {
      ok: false,
      reason: 'cross-origin',
    });
    assert.deepEqual(checkRedirect({ method: 'GET', from, location: '/x', hops: 3 }), { ok: false, reason: 'too-many-redirects' });
  });
});

describe('outbound headers', () => {
  const self = 'https://example.org';

  it('builds conditional reads, feed reads and JSON deliveries that pass the check', () => {
    const read = buildOutboundHeaders({ kind: 'read', self, etag: '"abc"', lastModified: 'Tue, 13 Oct 2026 12:00:00 GMT' });
    assert.deepEqual(read, {
      accept: 'application/json',
      'user-agent': 'islands/0 (+https://example.org)',
      'if-none-match': '"abc"',
      'if-modified-since': 'Tue, 13 Oct 2026 12:00:00 GMT',
    });
    const deliver = buildOutboundHeaders({ kind: 'deliver', self });
    assert.equal(deliver['content-type'], 'application/json');
    assert.ok(buildOutboundHeaders({ kind: 'feed', self }).accept.includes('application/atom+xml'));
    for (const headers of [read, deliver, new Headers(deliver)]) assert.deepEqual(checkOutboundHeaders(headers), { ok: true });
  });

  it('refuses every header outside the allowlist, credentials and custom tokens included', () => {
    for (const name of [
      'Cookie',
      'Authorization',
      'Proxy-Authorization',
      'Cf-Access-Jwt-Assertion',
      'CF-Access-Client-Secret',
      'X-API-Key',
      'X-Auth-Token',
      'X-Islands-Token',
      'X-Forwarded-For',
      'Origin',
    ]) {
      assert.deepEqual(checkOutboundHeaders({ [name]: 'synthetic-secret' }), { ok: false, reason: 'header-not-allowed', header: name });
    }
    assert.equal(checkOutboundHeaders(new Headers({ authorization: 'Bearer x' })).ok, false);
  });

  it('refuses forwarded incoming headers wholesale', () => {
    const incoming = new Headers({ accept: 'application/json', cookie: 'session=1', 'user-agent': 'Mozilla/5.0' });
    assert.equal(checkOutboundHeaders(incoming).ok, false);
  });

  it('refuses unsafe values and bad arguments', () => {
    assert.equal(checkOutboundHeaders({ accept: '' }).ok, false);
    assert.equal(checkOutboundHeaders({ 'user-agent': 'x'.repeat(2000) }).ok, false);
    assert.throws(() => buildOutboundHeaders({ kind: 'read', self, etag: 'a\r\nX-API-Key: 1' }));
    assert.throws(() => buildOutboundHeaders({ kind: 'read', self: 'https://Example.org' }));
    assert.throws(() => buildOutboundHeaders({ kind: /** @type {any} */ ('post'), self }));
  });
});

describe('address policy boundaries', () => {
  it('allows the public neighbours of refused IPv4 blocks', () => {
    for (const ip of ['9.255.255.255', '11.0.0.0', '100.63.255.255', '100.128.0.0', '126.255.255.255', '128.0.0.0',
      '169.253.255.255', '169.255.0.0', '172.15.255.255', '172.32.0.0', '192.0.1.0', '192.167.255.255', '192.169.0.0',
      '198.17.255.255', '198.20.0.0', '223.255.255.255']) {
      assert.equal(isForbiddenAddress(ip), false, ip);
    }
  });

  it('refuses the edges of refused IPv4 blocks, including documented exceptions', () => {
    for (const ip of ['10.0.0.0', '10.255.255.255', '100.64.0.0', '100.127.255.255', '172.16.0.0', '172.31.255.255',
      '192.0.0.9', '192.0.0.10', '198.18.0.0', '198.19.255.255', '224.0.0.0', '239.255.255.255', '240.0.0.0']) {
      assert.equal(isForbiddenAddress(ip), true, ip);
    }
  });

  it('draws the IPv6 lines where the policy says', () => {
    const allowed = ['2000::1', '2001:200::1', '2001:4860:4860::8888', '2002:808:808::1', '3ffe::1', '3fff:1000::1'];
    const refused = ['1fff:ffff::1', '2001:1ff:ffff::1', '2001:db8:ffff::1', '2002:a00:1::', '3fff:fff:ffff::1', '4000::1',
      '64:ff9b::a00:1', '64:ff9b:1::808:808', '::ffff:192.168.0.1'];
    for (const ip of allowed) assert.equal(isForbiddenAddress(ip), false, ip);
    for (const ip of refused) assert.equal(isForbiddenAddress(ip), true, ip);
  });
});
