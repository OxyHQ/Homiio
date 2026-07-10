/**
 * yaencontre + indomio normalize tests (pure fixtures).
 */

import {
  YaencontreProvider,
  IndomioProvider,
  parseYaencontreDetailJson,
  parseYaencontreSearchJson,
  parseIndomioDetailJson,
  parseIndomioSearchJson,
  YAENCONTRE_FIXTURE_DETAIL_JSON,
  YAENCONTRE_FIXTURE_SEARCH_JSON,
  INDOMIO_FIXTURE_DETAIL_JSON,
  INDOMIO_FIXTURE_SEARCH_JSON,
} from '@homiio/listing-providers';
import type { ExternalListingRef } from '@homiio/listing-providers';
import { OfferingType } from '@homiio/shared-types';

describe('YaencontreProvider.normalize', () => {
  const provider = new YaencontreProvider();

  it('maps detail JSON into a rent listing with contact', () => {
    const payload = parseYaencontreDetailJson(JSON.parse(YAENCONTRE_FIXTURE_DETAIL_JSON) as unknown);
    const ref: ExternalListingRef = { provider: 'yaencontre', sourceId: payload.sourceId, url: payload.url };
    const listing = provider.normalize({ ref, payload });
    expect(listing.source).toBe('yaencontre');
    expect(listing.longTermRent?.monthlyAmount).toBe(2100);
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.contact?.phone).toBe('910000111');
  });

  it('parses search JSON refs', () => {
    expect(parseYaencontreSearchJson(YAENCONTRE_FIXTURE_SEARCH_JSON)).toEqual([
      { sourceId: '987654321', url: 'https://www.yaencontre.com/alquiler/piso/madrid/987654321' },
    ]);
  });
});

describe('IndomioProvider.normalize', () => {
  const provider = new IndomioProvider();

  it('maps detail JSON into a rent listing with contact', () => {
    const payload = parseIndomioDetailJson(JSON.parse(INDOMIO_FIXTURE_DETAIL_JSON) as unknown);
    const ref: ExternalListingRef = { provider: 'indomio', sourceId: payload.sourceId, url: payload.url };
    const listing = provider.normalize({ ref, payload });
    expect(listing.source).toBe('indomio');
    expect(listing.longTermRent?.monthlyAmount).toBe(1650);
    expect(listing.contact?.phone).toBe('930000222');
  });

  it('parses search JSON refs', () => {
    expect(parseIndomioSearchJson(INDOMIO_FIXTURE_SEARCH_JSON)).toEqual([
      { sourceId: '876543210', url: 'https://www.indomio.es/anuncio/876543210/' },
    ]);
  });
});
