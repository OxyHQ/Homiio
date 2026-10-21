/**
 * The GeoIP trust boundary, as a SOURCE gate.
 *
 * The runtime tests next door pin what happens to each shape of address. These
 * pin the two structural facts a runtime test cannot: that nothing in the GeoIP
 * path parses `X-Forwarded-For` itself, and that the endpoint offers no way for
 * a caller to name the address being looked up.
 *
 * A gate rather than a comment, because both failures are one plausible commit
 * away. "Read the header directly so it works behind the CDN too" and "accept
 * `?ip=` so support can reproduce a user's result" are both reasonable-sounding
 * changes that would hand anybody the ability to relocate themselves — or, with
 * the resolution cache in front, to poison a network's answer for everyone
 * behind it.
 *
 * Both epics state the rule in the same words: "No confiar ciegamente en el
 * primer `X-Forwarded-For` … ni un endpoint que acepte cualquier `?ip=`
 * proporcionada por el cliente."
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import express from 'express';
import request from 'supertest';
import { oxyTrustProxy } from '@oxy.so/core/server';

import { clientAddressOf } from '../../services/geoip/clientIp';

const GEOIP_DIR = path.join(__dirname, '../../services/geoip');

function geoipSources(): { file: string; source: string }[] {
  return readdirSync(GEOIP_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({
      file: name,
      source: readFileSync(path.join(GEOIP_DIR, name), 'utf8'),
    }));
}

/**
 * Strip comments before scanning.
 *
 * Every file in this directory DISCUSSES `X-Forwarded-For` at length, precisely
 * because the rule needs explaining — so a naive substring scan would fail on
 * the prose that exists to prevent the bug. Only code is scanned.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the GeoIP path never reads a client-supplied address', () => {
  it('parses no forwarding header of its own', () => {
    for (const { file, source } of geoipSources()) {
      const code = codeOnly(source);
      for (const header of [
        'x-forwarded-for',
        'x-real-ip',
        'forwarded',
        'cf-connecting-ip',
        'true-client-ip',
      ]) {
        expect({ file, header, found: code.toLowerCase().includes(header) }).toEqual({
          file,
          header,
          found: false,
        });
      }
      expect({ file, readsHeaders: /req\.headers/.test(code) }).toEqual({
        file,
        readsHeaders: false,
      });
    }
  });

  it('resolves the address from req.ip', () => {
    const clientIp = readFileSync(path.join(GEOIP_DIR, 'clientIp.ts'), 'utf8');
    expect(codeOnly(clientIp)).toContain('req.ip');
  });

  it('reads no address from the query string or the body', () => {
    for (const { file, source } of geoipSources()) {
      const code = codeOnly(source);
      expect({ file, readsQuery: /req\.query/.test(code) }).toEqual({ file, readsQuery: false });
      expect({ file, readsBody: /req\.body/.test(code) }).toEqual({ file, readsBody: false });
    }
  });

  it('exposes the endpoint without an address parameter', () => {
    const controller = readFileSync(
      path.join(__dirname, '../../controllers/geoController.ts'),
      'utf8',
    );
    const handler = controller.slice(
      controller.indexOf('export async function approximateLocation'),
    );
    expect(handler).not.toMatch(/req\.query\.(ip|address|clientIp)/);
    // The one query parameter it may read is the label language.
    expect(handler).toContain('parseLanguage(req.query.language');
  });

  it('answers with a private, unstoreable cache policy', () => {
    const controller = readFileSync(
      path.join(__dirname, '../../controllers/geoController.ts'),
      'utf8',
    );
    const handler = controller.slice(
      controller.indexOf('export async function approximateLocation'),
    );
    // A shared cache anywhere on the path would hand one visitor's city to the
    // next one. Both epics name the header explicitly.
    expect(handler).toContain("'Cache-Control', 'private, no-store'");
  });
});

describe('the trust setting finds the person behind either chain', () => {
  it('is oxyTrustProxy, not a hop count', () => {
    // A fixed count is wrong on one of the two chains `api.homiio.com` can
    // have: `1` reports the Cloudflare edge as the client once the hostname is
    // proxied, `2` believes a forged entry while it is DNS-only.
    const server = readFileSync(path.join(__dirname, '../../server.ts'), 'utf8');
    expect(server).toContain("app.set('trust proxy', oxyTrustProxy)");
    expect(server).not.toMatch(/app\.set\('trust proxy',\s*\d/);
  });

  // supertest connects from loopback, which stands in for the ALB: a private
  // socket peer. The X-Forwarded-For values are what the ALB would hand on.
  const app = express();
  app.set('trust proxy', oxyTrustProxy);
  app.get('/whoami', (req, res) => {
    res.json({ ip: req.ip, lookup: clientAddressOf(req) });
  });

  const CLIENT = '203.0.113.7';
  const CLOUDFLARE_EDGE = '172.70.1.2';

  it.each([
    ['DNS-only: the ALB appends the client', CLIENT],
    ['DNS-only, with a forged entry to the left', `8.8.8.8, ${CLIENT}`],
    ['proxied: Cloudflare appends the client, the ALB the edge', `${CLIENT}, ${CLOUDFLARE_EDGE}`],
    ['proxied, with a forged entry to the left', `8.8.8.8, ${CLIENT}, ${CLOUDFLARE_EDGE}`],
    [
      'proxied, with a forged Cloudflare address to the left',
      `${CLOUDFLARE_EDGE}, ${CLIENT}, ${CLOUDFLARE_EDGE}`,
    ],
  ])('%s → req.ip and the GeoIP lookup are the client', async (_shape, forwarded) => {
    const res = await request(app).get('/whoami').set('X-Forwarded-For', forwarded);
    expect(res.body).toEqual({
      ip: CLIENT,
      lookup: { kind: 'public', address: CLIENT, family: 'ipv4' },
    });
  });

  it('never reports a Cloudflare edge as the person', async () => {
    const res = await request(app)
      .get('/whoami')
      .set('X-Forwarded-For', `${CLIENT}, ${CLOUDFLARE_EDGE}`);
    expect(res.body.ip).not.toBe(CLOUDFLARE_EDGE);
  });
});
