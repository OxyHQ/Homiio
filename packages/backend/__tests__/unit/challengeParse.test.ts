/**
 * Shared challenge heuristics (`parse/challenge.ts`).
 * Pure unit tests — no DB, no live portal hits.
 */

import {
  isCloudflareChallenge,
  isDataDomeAjaxChallenge,
  isDataDomeHtmlChallenge,
} from '@homiio/listing-providers/parse/challenge';

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
