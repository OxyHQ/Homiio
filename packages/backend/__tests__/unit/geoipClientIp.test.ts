/**
 * The GeoIP trust boundary (#518 §4.2, #519 §4.2).
 *
 * These are the tests both epics ask for by name: "Las pruebas deben demostrar
 * que no se localiza el servidor/ALB ni se acepta un header falsificado", over
 * "IPv4, IPv6, IPv4-mapped IPv6, rangos privados/reservados, localhost,
 * cabeceras malformadas y múltiples saltos".
 *
 * ## Why the forged-header cases are expressed as `req.ip` inputs
 *
 * The forgery defence is not a check in `clientIp.ts` — it is the decision to
 * read `req.ip` and never `X-Forwarded-For`. Express's `proxy-addr` performs the
 * resolution, so a test that hand-fed a header and asserted an outcome would be
 * testing a reimplementation of Express rather than Homiio's code.
 *
 * So there are two tests, and they cover different things:
 *
 *  - these, which pin what `clientAddressOf` does with each shape of address a
 *    correctly-configured Express would hand it, INCLUDING the datacentre's own
 *    private address (the "no localizar el servidor" case); and
 *  - `geoipTrustBoundary.test.ts`, which pins that the module reads `req.ip`
 *    and that the route accepts no caller-supplied address at all.
 *
 * Together they say: the resolution is Express's, the refusals are ours, and
 * there is no third path into the lookup.
 */

import {
  clientAddressOf,
  isReservedAddress,
  normalizeAddress,
} from '../../services/geoip/clientIp';

describe('normalizeAddress', () => {
  it('unwraps an IPv4-mapped IPv6 address to its IPv4 form', () => {
    // A v4 client on a dual-stack socket. Every GeoIP database keys the v4
    // form; handed the v6 spelling it answers nothing, which is
    // indistinguishable from an unknown address.
    expect(normalizeAddress('::ffff:203.0.113.5')).toBe('203.0.113.5');
    expect(normalizeAddress('::FFFF:203.0.113.5')).toBe('203.0.113.5');
  });

  it('strips brackets and ports', () => {
    expect(normalizeAddress('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(normalizeAddress('[2001:db8::1]')).toBe('2001:db8::1');
    expect(normalizeAddress('203.0.113.5:51234')).toBe('203.0.113.5');
  });

  it('strips an IPv6 zone id, which is meaningful only on the sending host', () => {
    expect(normalizeAddress('fe80::1%eth0')).toBe('fe80::1');
  });

  it('does NOT cut a bare IPv6 address at its colons', () => {
    // The v4 port-stripping regex must not fire here. If it did, every IPv6
    // visitor would be looked up as a truncated, meaningless address.
    expect(normalizeAddress('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:85a3::8a2e:370:7334');
  });

  it('answers null for empty and whitespace input', () => {
    expect(normalizeAddress('')).toBeNull();
    expect(normalizeAddress('   ')).toBeNull();
  });
});

describe('isReservedAddress', () => {
  it.each([
    ['127.0.0.1', 'IPv4 loopback'],
    ['10.0.0.7', 'private 10/8'],
    ['172.16.4.2', 'private 172.16/12'],
    ['172.31.255.254', 'private 172.16/12, upper edge'],
    ['192.168.1.1', 'private 192.168/16'],
    ['169.254.10.1', 'link-local'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['100.127.255.255', 'carrier-grade NAT, upper edge'],
    ['0.0.0.0', 'this network'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 unspecified'],
    ['fd00::1', 'IPv6 unique local'],
    ['fe80::1', 'IPv6 link-local'],
  ])('refuses %s (%s)', (address) => {
    expect(isReservedAddress(address)).toBe(true);
  });

  it.each([
    ['203.0.113.5'],
    ['8.8.8.8'],
    ['172.15.0.1'], // one below the private block
    ['172.32.0.1'], // one above it
    ['100.63.255.255'], // one below CGNAT
    ['100.128.0.1'], // one above it
    ['2001:db8::1'],
  ])('accepts %s as a public address', (address) => {
    expect(isReservedAddress(address)).toBe(false);
  });
});

describe('clientAddressOf', () => {
  it('reads req.ip and reports a public IPv4 address', () => {
    expect(clientAddressOf({ ip: '203.0.113.5' })).toEqual({
      kind: 'public',
      address: '203.0.113.5',
      family: 'ipv4',
    });
  });

  it('reports a public IPv6 address', () => {
    expect(clientAddressOf({ ip: '2001:db8::1' })).toEqual({
      kind: 'public',
      address: '2001:db8::1',
      family: 'ipv6',
    });
  });

  it('normalises an IPv4-mapped address to the v4 family', () => {
    expect(clientAddressOf({ ip: '::ffff:203.0.113.5' })).toEqual({
      kind: 'public',
      address: '203.0.113.5',
      family: 'ipv4',
    });
  });

  it('refuses the load balancer’s own private address rather than locating the datacentre', () => {
    // The case both epics name first: a server-side render, a health probe or
    // an internal caller must NOT be handed the infrastructure's city, and must
    // certainly not have it cached and served to everyone.
    expect(clientAddressOf({ ip: '10.0.3.14' })).toEqual({ kind: 'private' });
  });

  it('refuses loopback, so a local dev request resolves to neutral discovery', () => {
    expect(clientAddressOf({ ip: '::1' })).toEqual({ kind: 'private' });
    expect(clientAddressOf({ ip: '127.0.0.1' })).toEqual({ kind: 'private' });
  });

  it('refuses a malformed value instead of passing it to the database', () => {
    expect(clientAddressOf({ ip: 'unknown' })).toEqual({ kind: 'absent' });
    expect(clientAddressOf({ ip: 'not an address' })).toEqual({ kind: 'absent' });
    expect(clientAddressOf({ ip: '' })).toEqual({ kind: 'absent' });
    expect(clientAddressOf({})).toEqual({ kind: 'absent' });
  });

  it('falls back to the socket peer, which carries no client-supplied data', () => {
    expect(clientAddressOf({ socket: { remoteAddress: '198.51.100.9' } })).toEqual({
      kind: 'public',
      address: '198.51.100.9',
      family: 'ipv4',
    });
  });

  it('prefers req.ip over the socket peer', () => {
    // Behind the ALB the socket peer IS the ALB. Reading it in preference to
    // `req.ip` would locate every visitor in the datacentre.
    expect(
      clientAddressOf({ ip: '203.0.113.5', socket: { remoteAddress: '10.0.3.14' } }),
    ).toEqual({ kind: 'public', address: '203.0.113.5', family: 'ipv4' });
  });
});
