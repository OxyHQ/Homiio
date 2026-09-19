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
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the GeoIP path never reads a client-supplied address', () => {
  it('parses no forwarding header of its own', () => {
    for (const { file, source } of geoipSources()) {
      const code = codeOnly(source);
      for (const header of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'true-client-ip']) {
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
    const handler = controller.slice(controller.indexOf('export async function approximateLocation'));
    expect(handler).not.toMatch(/req\.query\.(ip|address|clientIp)/);
    // The one query parameter it may read is the label language.
    expect(handler).toContain('parseLanguage(req.query.language');
  });

  it('answers with a private, unstoreable cache policy', () => {
    const controller = readFileSync(
      path.join(__dirname, '../../controllers/geoController.ts'),
      'utf8',
    );
    const handler = controller.slice(controller.indexOf('export async function approximateLocation'));
    // A shared cache anywhere on the path would hand one visitor's city to the
    // next one. Both epics name the header explicitly.
    expect(handler).toContain("'Cache-Control', 'private, no-store'");
  });
});

describe('the deployed topology matches the trust setting', () => {
  it('trusts exactly one proxy hop', () => {
    // `api.homiio.com` is an ALB host rule straight onto the task, with no CDN
    // in front (oxy-infra: app-services.tf's `host_headers`, and cdn.tf, which
    // fronts only the media bucket). One hop is therefore the correct setting,
    // and `req.ip` is the right-most address the ALB itself appended — so a
    // forged header, which lands to the LEFT of it, cannot win.
    //
    // Pinned here because raising this number is how the defence silently
    // breaks: `trust proxy: 2` behind a one-hop ingress makes `req.ip` the last
    // entry a CLIENT supplied.
    const server = readFileSync(path.join(__dirname, '../../server.ts'), 'utf8');
    expect(server).toContain("app.set('trust proxy', 1)");
  });
});
