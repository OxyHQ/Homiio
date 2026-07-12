/**
 * Shared challenge heuristics (`parse/challenge.ts`).
 * Pure unit tests — no DB, no live portal hits.
 */

import {
  isAntiBotChallenge,
  isCloudflareChallenge,
  isDataDomeAjaxChallenge,
  isDataDomeHtmlChallenge,
} from '@homiio/listing-providers/parse/challenge';

describe('isAntiBotChallenge', () => {
  it('flags challenge / block pages across the major anti-bot vendors', () => {
    const walls: Record<string, string> = {
      datadome:
        '<html><body>Please enable JS and disable any ad blocker' +
        '<script src="https://ct.captcha-delivery.com/c.js"></script></body></html>',
      kasada:
        '<html><head><script>fetch("/tl",{headers:{"x-kpsdk-ct":"a","x-kpsdk-cd":"b"}})</script></head></html>',
      awsWaf:
        '<html><body><script src="https://x.token.awswaf.com/x/challenge.js"></script></body></html>',
      perimeterx:
        '<html><body><div id="px-captcha"></div>Access to this page has been denied</body></html>',
      cloudflare:
        '<html><head><title>Just a moment...</title></head><body>' +
        '<div class="cf-browser-verification"></div>/cdn-cgi/challenge-platform/h/g</body></html>',
      incapsula:
        '<html><body>Request unsuccessful. Incapsula incident ID: 1-234<script>_Incapsula_Resource</script></body></html>',
      akamai: '<html><head><title>Access Denied</title></head><body>no permission</body></html>',
    };
    for (const [vendor, html] of Object.entries(walls)) {
      expect([vendor, isAntiBotChallenge(html)]).toEqual([vendor, true]);
    }
  });

  it('does NOT flag good pages that embed a passive sensor or a captcha site key', () => {
    // A live Otodom SERP carries both of these on a real 37-listing page.
    const goodSerp =
      '<html><body><script>window.__cmp={"purposes":{"datadome":["C0001"]}};' +
      'window.__CONFIG__={"googleReCaptchaApiKey":"6Ld4ej","isReCaptchaEnabled":true};</script>' +
      '<article data-cy="listing-item">flat in Warsaw</article></body></html>';
    expect(isAntiBotChallenge(goodSerp)).toBe(false);
    // A page merely fronted by a CDN (Cloudflare/Akamai) is not a challenge.
    expect(isAntiBotChallenge('<html><body>Powered by cloudflare and akamai CDN</body></html>')).toBe(
      false,
    );
  });
});

describe('isDataDomeAjaxChallenge', () => {
  it('flags captcha-delivery HTML and geo challenge JSON', () => {
    expect(isDataDomeAjaxChallenge('<!DOCTYPE html><html>geo.captcha-delivery.com</html>')).toBe(
      true,
    );
    expect(
      isDataDomeAjaxChallenge('{"url":"https://geo.captcha-delivery.com/captcha"}'),
    ).toBe(true);
  });

  it('accepts normal JSON payloads', () => {
    expect(isDataDomeAjaxChallenge('{"ads":[{"id":"1"}]}')).toBe(false);
  });
});

describe('isDataDomeHtmlChallenge', () => {
  it('treats captcha interstitials as challenges but not pages with listing markup', () => {
    expect(isDataDomeHtmlChallenge('<html>geo.captcha-delivery.com</html>')).toBe(true);
    expect(
      isDataDomeHtmlChallenge(
        `<html>${'x'.repeat(600)}<article class="item">ok</article></html>`,
        true,
      ),
    ).toBe(false);
  });
});

describe('isCloudflareChallenge', () => {
  it('flags Cloudflare interstitials and tiny bodies', () => {
    expect(isCloudflareChallenge('<html>Just a moment...</html>')).toBe(true);
    expect(isCloudflareChallenge('tiny')).toBe(true);
  });

  it('accepts normal-sized listing HTML', () => {
    const html = `<html><body>${'listing content '.repeat(40)}</body></html>`;
    expect(isCloudflareChallenge(html)).toBe(false);
  });
});
