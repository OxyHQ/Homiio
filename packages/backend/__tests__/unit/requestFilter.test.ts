/**
 * Browser-tier request filtering: only the portal's own domain + anti-bot
 * vendors ride the residential proxy; ads/trackers/maps/video are dropped.
 */

import {
  registrableDomain,
  isAllowedBrowserRequest,
  portalDomainFromUrl,
} from '@homiio/listing-providers';

describe('registrableDomain', () => {
  it('returns eTLD+1 for plain TLDs', () => {
    expect(registrableDomain('www.habitaclia.com')).toBe('habitaclia.com');
    expect(registrableDomain('web.gw.habitaclia.com')).toBe('habitaclia.com');
    expect(registrableDomain('www.fotocasa.es')).toBe('fotocasa.es');
    expect(registrableDomain('idealista.com')).toBe('idealista.com');
  });

  it('honours compound public suffixes', () => {
    expect(registrableDomain('www.rightmove.co.uk')).toBe('rightmove.co.uk');
    expect(registrableDomain('inmuebles.mercadolibre.com.mx')).toBe('mercadolibre.com.mx');
  });
});

describe('isAllowedBrowserRequest', () => {
  const portal = 'habitaclia.com';

  it('allows the portal domain and its subdomains', () => {
    expect(isAllowedBrowserRequest('https://www.habitaclia.com/x.htm', portal)).toBe(true);
    expect(isAllowedBrowserRequest('https://web.gw.habitaclia.com/api', portal)).toBe(true);
    expect(isAllowedBrowserRequest('https://widgets.habitaclia.com/w.js', portal)).toBe(true);
  });

  it('allows anti-bot vendors a warm session needs', () => {
    expect(isAllowedBrowserRequest('https://geo.captcha-delivery.com/js', portal)).toBe(true);
    expect(isAllowedBrowserRequest('https://challenges.cloudflare.com/turnstile', portal)).toBe(true);
  });

  it('blocks third-party ads/trackers/maps/video', () => {
    for (const url of [
      'https://accounts.google.com/gsi',
      'https://www.youtube.com/embed/x',
      'https://maps.googleapis.com/maps/api/js',
      'https://connect.facebook.net/en_US/sdk.js',
      'https://stats.g.doubleclick.net/x',
      'https://sb.scorecardresearch.com/beacon.js',
      'https://static.criteo.net/x',
      'https://unpkg.com/lib',
    ]) {
      expect(isAllowedBrowserRequest(url, portal)).toBe(false);
    }
  });

  it('blocks malformed URLs', () => {
    expect(isAllowedBrowserRequest('not-a-url', portal)).toBe(false);
  });
});

describe('portalDomainFromUrl', () => {
  it('extracts the registrable domain of a page URL', () => {
    expect(portalDomainFromUrl('https://www.idealista.com/alquiler/madrid/')).toBe('idealista.com');
    expect(portalDomainFromUrl('garbage')).toBeUndefined();
  });
});
