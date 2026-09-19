/**
 * The Sindi action contract, as a boundary (#519 §8.4, §8.8).
 *
 * Everything here is a pure function, deliberately: the rules the issue lists
 * are about WHAT MAY BE APPLIED, and a rule about applicability asserted by
 * rendering a chat and simulating a stream is a test that passes for whichever
 * reason the mock happened to produce. Stated over `parseSindiActionEnvelope`,
 * `envelopeRefusal` and `applySearchPatch`, each is an ordinary assertion.
 *
 * The negative cases are the point of the file. A validator with no test for
 * what it REFUSES is a validator that will quietly start accepting.
 */

import {
  parseSindiAction,
  parseSindiActionEnvelope,
  parseSindiSearchPatch,
  SINDI_ACTION_VERSION,
  type SindiActionEnvelope,
} from '@homiio/shared-types';
import { OfferingType, PropertyType } from '@homiio/shared-types';

import { applySearchPatch, envelopeRefusal } from '@/hooks/sindiActionRules';
import { DEFAULT_SEARCH_QUERY } from '@/store/searchQueryStore';
import type { SearchQuery } from '@/components/search/types';

const envelope = (overrides: Partial<SindiActionEnvelope> = {}): SindiActionEnvelope => ({
  version: SINDI_ACTION_VERSION,
  actionId: 'a1',
  turnId: 't1',
  contextRevision: 7,
  action: { kind: 'apply_search', patch: { priceMax: 1200 } },
  ...overrides,
});

describe('the action union is closed', () => {
  it('accepts each of the five permitted intents', () => {
    expect(parseSindiAction({ kind: 'apply_search', patch: { priceMax: 1200 } })).toEqual({
      kind: 'apply_search',
      patch: { priceMax: 1200 },
    });
    expect(parseSindiAction({ kind: 'show_saved' })).toEqual({ kind: 'show_saved' });
    expect(parseSindiAction({ kind: 'open_listing', propertyId: 'abc123' })).toEqual({
      kind: 'open_listing',
      propertyId: 'abc123',
    });
    expect(parseSindiAction({ kind: 'set_results_view', view: 'map' })).toEqual({
      kind: 'set_results_view',
      view: 'map',
    });
    expect(parseSindiAction({ kind: 'navigate', destination: 'saved' })).toEqual({
      kind: 'navigate',
      destination: 'saved',
    });
  });

  it.each([
    ['an unknown intent', { kind: 'delete_account' }],
    ['a write dressed as a navigation', { kind: 'pay_rent', leaseId: 'x' }],
    ['a raw URL', { kind: 'navigate', destination: 'https://example.com' }],
    ['a path instead of a destination', { kind: 'navigate', destination: '/properties/1' }],
    ['a view that is not list or map', { kind: 'set_results_view', view: 'globe' }],
    ['a listing id with a path in it', { kind: 'open_listing', propertyId: '../../admin' }],
    ['a folder id with a quote in it', { kind: 'show_saved', folderId: "a' or 1=1" }],
    ['no kind at all', { patch: {} }],
    ['a string', 'apply_search'],
    ['null', null],
  ])('refuses %s', (_label, value) => {
    expect(parseSindiAction(value)).toBeNull();
  });

  it('refuses an apply_search whose patch changes nothing', () => {
    // A no-op patch would make Sindi claim to have applied a search while the
    // screen stayed identical.
    expect(parseSindiAction({ kind: 'apply_search', patch: {} })).toBeNull();
    expect(parseSindiAction({ kind: 'apply_search', patch: { nonsense: 1 } })).toBeNull();
  });
});

describe('the patch validator drops what it does not recognise', () => {
  it('keeps the fields it knows', () => {
    expect(
      parseSindiSearchPatch({
        offering: OfferingType.SHORT_TERM_RENT,
        priceMax: 1200,
        bedrooms: 2,
        petFriendly: true,
        amenities: ['parking', 'balcony'],
        queryText: 'loft',
      }),
    ).toEqual({
      offering: OfferingType.SHORT_TERM_RENT,
      priceMax: 1200,
      bedrooms: 2,
      petFriendly: true,
      amenities: ['parking', 'balcony'],
      queryText: 'loft',
    });
  });

  it('drops a negative price and a fractional room count rather than coercing them', () => {
    expect(parseSindiSearchPatch({ priceMax: -5, bedrooms: 1.5, priceMin: 400 })).toEqual({
      priceMin: 400,
    });
  });

  it('accepts an explicit null queryText, which clears the text dimension', () => {
    expect(parseSindiSearchPatch({ queryText: null })).toEqual({ queryText: null });
  });
});

describe('the envelope is addressed to one turn', () => {
  it('accepts a well-formed envelope', () => {
    expect(parseSindiActionEnvelope(envelope())).toEqual(envelope());
  });

  it('refuses another contract version', () => {
    // An older client must not guess at a payload whose meaning changed.
    expect(parseSindiActionEnvelope({ ...envelope(), version: 99 })).toBeNull();
    expect(parseSindiActionEnvelope({ ...envelope(), version: undefined })).toBeNull();
  });

  it('refuses an envelope with no turn or no action id', () => {
    expect(parseSindiActionEnvelope({ ...envelope(), turnId: '' })).toBeNull();
    expect(parseSindiActionEnvelope({ ...envelope(), actionId: undefined })).toBeNull();
  });

  it('refuses a missing or negative context revision', () => {
    expect(parseSindiActionEnvelope({ ...envelope(), contextRevision: undefined })).toBeNull();
    expect(parseSindiActionEnvelope({ ...envelope(), contextRevision: -1 })).toBeNull();
  });

  it('refuses an unrelated data frame without throwing', () => {
    // The data channel is shared. A frame that is not ours must be skipped, not
    // crash the chat.
    for (const frame of [null, 42, 'text', [], { hello: 'world' }]) {
      expect(parseSindiActionEnvelope(frame)).toBeNull();
    }
  });
});

describe('when an action may still be applied', () => {
  const base = { activeTurnId: 't1', contextRevision: 7, alreadyApplied: false };

  it('lets a fresh action for the active turn through', () => {
    expect(envelopeRefusal({ ...base, envelope: envelope() })).toBeNull();
  });

  it('refuses an action whose id has already run — a replay navigates once', () => {
    expect(envelopeRefusal({ ...base, envelope: envelope(), alreadyApplied: true })).toBe(
      'rejected',
    );
  });

  it('refuses an action from a CANCELLED turn — this is what makes Stop stop', () => {
    expect(envelopeRefusal({ ...base, activeTurnId: null, envelope: envelope() })).toBe('stale');
  });

  it('refuses an action from a previous turn', () => {
    expect(envelopeRefusal({ ...base, envelope: envelope({ turnId: 't0' }) })).toBe('stale');
  });

  it('refuses an action whose context the user has since changed by hand', () => {
    // #519 §8.8: "Si el usuario cambia un filtro manualmente después del
    // contexto enviado, ese cambio gana."
    expect(envelopeRefusal({ ...base, contextRevision: 8, envelope: envelope() })).toBe('stale');
  });

  it('checks the dedupe BEFORE the turn, so a replay is not reported as a conflict', () => {
    expect(
      envelopeRefusal({ ...base, activeTurnId: null, envelope: envelope(), alreadyApplied: true }),
    ).toBe('rejected');
  });
});

describe('applying a patch preserves what it does not mention', () => {
  const madrid: SearchQuery = {
    ...DEFAULT_SEARCH_QUERY,
    queryText: 'loft',
    priceMax: 1500,
    bedrooms: 1,
    location: {
      kind: 'place',
      source: { kind: 'homiio', entity: 'city', id: 'city-madrid' },
      placeType: 'city',
      label: { primary: 'Madrid', kind: 'place' },
      admin: { countryCode: 'ES', cityName: 'Madrid' },
      precision: 'centroid',
      center: { longitude: -3.7038, latitude: 40.4168 },
    },
  };

  it('keeps the area and the budget when only the bedrooms change', () => {
    // "Ahora con dos habitaciones y que admitan mascotas" — the case #519 §8.1
    // names, and the whole reason the payload is a patch.
    const next = applySearchPatch(madrid, { bedrooms: 2, petFriendly: true });

    expect(next.bedrooms).toBe(2);
    expect(next.petFriendly).toBe(true);
    expect(next.location).toEqual(madrid.location);
    expect(next.priceMax).toBe(1500);
    expect(next.queryText).toBe('loft');
  });

  it('replaces the whole geographic selection rather than merging into it', () => {
    const barcelona = {
      kind: 'place' as const,
      source: { kind: 'homiio' as const, entity: 'city' as const, id: 'city-barcelona' },
      placeType: 'city' as const,
      label: { primary: 'Barcelona', kind: 'place' as const },
      admin: { countryCode: 'ES', cityName: 'Barcelona' },
      precision: 'centroid' as const,
      center: { longitude: 2.1686, latitude: 41.3874 },
    };
    const next = applySearchPatch(madrid, { location: barcelona });

    expect(next.location).toEqual(barcelona);
    // Nothing of Madrid survives inside it — "the old city with the new bounds"
    // is the combination ADR 0002 §3 makes unrepresentable.
    expect(JSON.stringify(next.location)).not.toContain('Madrid');
  });

  it('applies the offering FIRST, so a patch carrying both keeps its price', () => {
    // `setOffering` clears the price range on purpose — a monthly rent is not a
    // nightly rate — so the ordering is what stops the price being dropped.
    const next = applySearchPatch(madrid, {
      offering: OfferingType.SHORT_TERM_RENT,
      priceMax: 90,
    });

    expect(next.offering).toBe(OfferingType.SHORT_TERM_RENT);
    expect(next.priceMax).toBe(90);
  });

  it('clears the price when the offering changes and the patch names no new one', () => {
    const next = applySearchPatch(madrid, { offering: OfferingType.SALE });

    expect(next.offering).toBe(OfferingType.SALE);
    // A monthly-rent ceiling carried into a sale search would filter out every
    // home ever sold.
    expect(next.priceMax).toBeUndefined();
  });

  it('copies array fields rather than aliasing the patch', () => {
    const amenities = ['parking'];
    const next = applySearchPatch(madrid, {
      amenities,
      propertyTypes: [PropertyType.APARTMENT],
    });

    expect(next.amenities).toEqual(['parking']);
    expect(next.amenities).not.toBe(amenities);
  });

  it('changes nothing at all for an empty patch', () => {
    expect(applySearchPatch(madrid, {})).toEqual(madrid);
  });
});
