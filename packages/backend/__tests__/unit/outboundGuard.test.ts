/**
 * The SSRF guard on `POST /api/scraper/run`.
 *
 * `endpoint` comes straight off the request body and the process runs inside
 * the VPC, so an unguarded GET reaches the ECS task-metadata endpoint — the
 * task role's IAM credentials — and every internal service. CodeQL has called
 * this `js/request-forgery` at CRITICAL since 2025-08-23; `requireAdmin` bounds
 * who can call it, not what it can reach.
 *
 * These tests exercise the two defeats a string check does not survive:
 * a redirect to a link-local address, and a name that resolves to one. The
 * redirect case runs against a REAL HTTP server issuing a REAL 302, because
 * "axios was configured not to follow redirects" is a claim about a config
 * object and "the request did not reach the second server" is a fact.
 */

import http from 'node:http';
import axios from 'axios';
import {
  assertAllowedScraperEndpoint,
  BlockedOutboundRequestError,
  guardedRequestConfig,
  scraperAllowedOrigins,
  __testing,
} from '../../utils/outboundGuard';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('assertAllowedScraperEndpoint', () => {
  it('refuses everything when no origins are configured', () => {
    // The default must be "none", not "any". A default of any host is what made
    // the finding critical; a default of none fails as a 400.
    delete process.env.SCRAPER_ALLOWED_ORIGINS;
    expect(() => assertAllowedScraperEndpoint('https://feeds.example.com/x')).toThrow(
      BlockedOutboundRequestError,
    );
    expect(scraperAllowedOrigins().size).toBe(0);
  });

  it('allows exactly the configured origin and nothing beside it', () => {
    process.env.SCRAPER_ALLOWED_ORIGINS = 'https://feeds.example.com';

    expect(assertAllowedScraperEndpoint('https://feeds.example.com/listings.json').origin).toBe(
      'https://feeds.example.com',
    );

    for (const blocked of [
      'https://feeds.example.com.evil.test/x', // suffix trick
      'https://evil.test/?x=https://feeds.example.com', // substring trick
      'http://feeds.example.com/x', // scheme differs -> different origin
      'https://feeds.example.com:8443/x', // port differs -> different origin
    ]) {
      expect(() => assertAllowedScraperEndpoint(blocked)).toThrow(BlockedOutboundRequestError);
    }
  });

  it('blocks the targets that make this critical, even if someone allow-lists them', () => {
    // Origin allow-listing is the first layer, not the only one. Even named
    // explicitly, these must not survive the address check at connect time —
    // asserted directly here, and through a real socket below.
    for (const address of [
      '169.254.170.2', // ECS task metadata -> IAM credentials
      '169.254.169.254', // IMDS
      '127.0.0.1',
      '10.0.0.5',
      '172.16.0.1',
      '192.168.1.1',
      '100.64.0.1', // CGNAT
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:169.254.170.2', // IPv4-mapped reaches the same interface
    ]) {
      expect(__testing.isBlockedAddress(address)).toBe(true);
    }
  });

  it('permits ordinary public addresses', () => {
    for (const address of ['93.184.216.34', '1.1.1.1', '2606:4700::1111']) {
      expect(__testing.isBlockedAddress(address)).toBe(false);
    }
  });

  it('refuses non-http schemes and embedded credentials', () => {
    process.env.SCRAPER_ALLOWED_ORIGINS = 'https://feeds.example.com';
    for (const blocked of [
      'file:///etc/passwd',
      'gopher://feeds.example.com/x',
      'https://user:pass@feeds.example.com/x',
      'not-a-url',
    ]) {
      expect(() => assertAllowedScraperEndpoint(blocked)).toThrow(BlockedOutboundRequestError);
    }
  });
});

describe('guardedRequestConfig', () => {
  it('does not follow a redirect, which is the documented way past an allowlist', async () => {
    // An allow-listed host answering `302 Location: http://169.254.170.2/...`
    // defeats any check made before the request. Two real servers: the second
    // records whether it was ever reached.
    let secondHopReached = false;
    const secondHop = http.createServer((_req, res) => {
      secondHopReached = true;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"stolen":true}');
    });
    const secondPort = await listen(secondHop);

    const redirector = http.createServer((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${secondPort}/creds` });
      res.end();
    });
    const firstPort = await listen(redirector);

    try {
      const config = guardedRequestConfig();
      const response = await axios.get(`http://127.0.0.1:${firstPort}/feed`, {
        ...config,
        validateStatus: () => true,
      });

      // `maxRedirects: 0` makes axios HAND BACK the 302 rather than throw, so
      // the assertion that matters is not the status — it is that the second
      // server was never contacted. Without the guard, axios follows the hop
      // and this flips to true while the first assertion still passes, which is
      // exactly why the second server records being reached.
      expect(secondHopReached).toBe(false);
      expect(response.status).toBe(302);
    } finally {
      await close(redirector);
      await close(secondHop);
    }
  });

  it('refuses a NAME that resolves to an internal address, and is what blocks it', async () => {
    // The rebinding case, as a differential test. `localhost` is a name that
    // resolves to loopback — standing in for a hostile name resolving to
    // 169.254.170.2 at connect time, after any up-front check has passed.
    //
    // The server is real and answers, so an unguarded request SUCCEEDS. That
    // second assertion is the point: without it this test would also pass if
    // the host were simply unreachable, proving nothing about the lookup.
    //
    // A literal IP would not exercise the guard at all — `net.connect` skips
    // DNS for literals, so `lookup` is never called. It has to be a name.
    let reached = false;
    const server = http.createServer((_req, res) => {
      reached = true;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"internal":true}');
    });
    const port = await listen(server);

    try {
      await expect(
        axios.get(`http://localhost:${port}/creds`, {
          ...guardedRequestConfig(),
          timeout: 5_000,
        }),
      ).rejects.toBeDefined();
      expect(reached).toBe(false);

      // Same URL, no guard: the request goes through. This is what the guard
      // is preventing, demonstrated rather than asserted.
      const unguarded = await axios.get(`http://localhost:${port}/creds`, { timeout: 5_000 });
      expect(unguarded.status).toBe(200);
      expect(reached).toBe(true);
    } finally {
      await close(server);
    }
  });
});
