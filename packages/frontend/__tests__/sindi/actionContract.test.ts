/**
 * The Sindi host-tool contract, as a boundary (#519 §8.4, §8.8; Alia
 * `docs/agent-embedding.md` §2).
 *
 * Everything here is a pure function, deliberately: the rules are about WHAT
 * MAY BE APPLIED, and a rule about applicability asserted by rendering a chat
 * and simulating a stream is a test that passes for whichever reason the mock
 * happened to produce.
 *
 * The negative cases are the point of the file. A validator with no test for
 * what it REFUSES is a validator that will quietly start accepting — and the
 * declaration the model reads is pinned to the same field table, so the two
 * cannot drift apart.
 */

import {
  OfferingType,
  PropertyType,
  parseSindiAction,
  parseSindiHostCall,
  parseSindiSearchPatch,
  SINDI_DESTINATIONS,
  SINDI_HOST_TOOLS,
} from '@homiio/shared-types';

import {
  actionOfHostCall,
  hostOutcomeOf,
  SINDI_HOST_APP,
  SINDI_HOST_TOOL_DEFINITIONS,
} from '@/components/sindi/sindiHostTools';
import { applySearchPatch, turnRefusal } from '@/hooks/sindiActionRules';
import { DEFAULT_SEARCH_QUERY } from '@/store/searchQueryStore';
import type { SearchQuery } from '@/components/search/types';

describe('the declaration Alia receives', () => {
  it('declares exactly the five intents, under names the wire contract accepts', () => {
    expect(SINDI_HOST_TOOL_DEFINITIONS.map(({ name }) => name)).toEqual([
      'apply_search',
      'show_saved',
      'open_listing',
      'set_results_view',
      'navigate',
    ]);
    // `docs/agent-embedding.md` §2: app `^[a-z][a-z0-9-]{0,31}$`, tool
    // `^[a-z][a-z0-9_]{0,47}$`, at most 16 tools, an object root each.
    expect(SINDI_HOST_APP).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
    expect(SINDI_HOST_TOOL_DEFINITIONS.length).toBeLessThanOrEqual(16);
    for (const tool of SINDI_HOST_TOOL_DEFINITIONS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('serialises to JSON with nothing lost — it travels in every request', () => {
    expect(JSON.parse(JSON.stringify(SINDI_HOST_TOOL_DEFINITIONS))).toEqual(
      SINDI_HOST_TOOL_DEFINITIONS,
    );
  });

  it('declares no write: no tool names a payment, a signature, an application or a deletion', () => {
    const declared = JSON.stringify(SINDI_HOST_TOOL_DEFINITIONS.map(({ name }) => name));
    for (const word of ['pay', 'sign', 'apply_to', 'delete', 'message', 'publish']) {
      expect(declared).not.toContain(word);
    }
  });

  it('offers navigate only the enumerated destinations, never a free string', () => {
    const navigate = SINDI_HOST_TOOLS.find(({ name }) => name === 'navigate');
    if (!navigate) throw new Error('navigate is not declared');
    const properties = navigate.inputSchema.properties as Record<string, { enum?: unknown }>;
    expect(properties.destination.enum).toEqual([...SINDI_DESTINATIONS]);
    expect(navigate.inputSchema.required).toEqual(['destination']);
  });

  it("builds apply_search's schema from the same fields the parser reads", () => {
    // One source of truth: every property the model is told about is one the
    // parser keeps, and the parser keeps nothing it was not told about.
    const applySearch = SINDI_HOST_TOOLS.find(({ name }) => name === 'apply_search');
    const declared = Object.keys(applySearch?.inputSchema.properties as object).sort();
    const sample = {
      offering: OfferingType.SALE,
      location: { kind: 'place' },
      queryText: 'loft',
      propertyTypes: [PropertyType.HOUSE],
      priceMin: 1,
      priceMax: 2,
      bedrooms: 1,
      bathrooms: 1,
      amenities: ['parking'],
      petFriendly: true,
    };
    expect(Object.keys(parseSindiSearchPatch(sample) ?? {}).sort()).toEqual(declared);
  });
});

describe('a host-tool call becomes one action of the closed union', () => {
  it('accepts each of the five permitted intents', () => {
    expect(parseSindiHostCall('apply_search', { priceMax: 1200 })).toEqual({
      kind: 'apply_search',
      patch: { priceMax: 1200 },
    });
    expect(parseSindiHostCall('show_saved', {})).toEqual({ kind: 'show_saved' });
    expect(parseSindiHostCall('show_saved', { folderId: 'f1' })).toEqual({
      kind: 'show_saved',
      folderId: 'f1',
    });
    expect(parseSindiHostCall('open_listing', { propertyId: 'abc123' })).toEqual({
      kind: 'open_listing',
      propertyId: 'abc123',
    });
    expect(parseSindiHostCall('set_results_view', { view: 'map' })).toEqual({
      kind: 'set_results_view',
      view: 'map',
    });
    expect(parseSindiHostCall('navigate', { destination: 'saved' })).toEqual({
      kind: 'navigate',
      destination: 'saved',
    });
  });

  it.each([
    ['an unknown tool', 'delete_account', {}],
    ['a write dressed as a navigation', 'pay_rent', { leaseId: 'x' }],
    ['the retired clarification', 'clarify_location', { requested: 'Barcelona' }],
    ['a raw URL', 'navigate', { destination: 'https://example.com' }],
    ['a path instead of a destination', 'navigate', { destination: '/properties/1' }],
    ['no destination at all', 'navigate', {}],
    ['a view that is not list or map', 'set_results_view', { view: 'globe' }],
    ['a listing id with a path in it', 'open_listing', { propertyId: '../../admin' }],
    ['no listing id', 'open_listing', {}],
    ['a folder id with a quote in it', 'show_saved', { folderId: "a' or 1=1" }],
    ['a search that changes nothing', 'apply_search', {}],
    ['a search of fields nobody declared', 'apply_search', { nonsense: 1 }],
    ['an input that is not an object', 'navigate', 'explore'],
    ['a null input', 'show_saved', null],
  ])('refuses %s', (_label, name, input) => {
    expect(parseSindiHostCall(name, input)).toBeNull();
  });

  it("refuses another app's call even when its name is one of ours", () => {
    expect(
      actionOfHostCall({
        toolCallId: 'c1',
        app: 'elsewhere',
        name: 'navigate',
        input: { destination: 'saved' },
      }),
    ).toBeNull();
    expect(
      actionOfHostCall({
        toolCallId: 'c1',
        app: SINDI_HOST_APP,
        name: 'navigate',
        input: { destination: 'saved' },
      }),
    ).toEqual({ kind: 'navigate', destination: 'saved' });
  });

  it('reads an action object the same way (`{ kind, …fields }`)', () => {
    expect(parseSindiAction({ kind: 'apply_search', patch: { priceMax: 900 } })).toEqual({
      kind: 'apply_search',
      patch: { priceMax: 900 },
    });
    expect(parseSindiAction({ kind: 'navigate', destination: 'home' })).toEqual({
      kind: 'navigate',
      destination: 'home',
    });
    expect(parseSindiAction({ patch: {} })).toBeNull();
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

  it('drops an offering or a property type outside the enums', () => {
    expect(
      parseSindiSearchPatch({ offering: 'timeshare', propertyTypes: ['castle'], priceMax: 1 }),
    ).toEqual({ priceMax: 1 });
  });

  it('accepts an explicit null queryText, which clears the text dimension', () => {
    expect(parseSindiSearchPatch({ queryText: null })).toEqual({ queryText: null });
  });
});

describe('what the model reads back', () => {
  it.each(['applied', 'inline', 'rejected', 'stale', 'failed'] as const)(
    'reports %s as itself, with a line no longer than the wire carries',
    (outcome) => {
      const reported = hostOutcomeOf(outcome);
      expect(reported.outcome).toBe(outcome);
      expect(reported.detail?.length).toBeGreaterThan(0);
      expect(reported.detail?.length).toBeLessThanOrEqual(500);
    },
  );

  it('never tells the model a refused action happened', () => {
    for (const outcome of ['inline', 'rejected', 'stale', 'failed'] as const) {
      expect(hostOutcomeOf(outcome).detail).not.toMatch(/^Done/);
    }
  });
});

describe('when an action may still be applied', () => {
  it('lets an action through when the search is as it was when the turn was sent', () => {
    expect(turnRefusal({ turnRevision: 7, currentRevision: 7 })).toBeNull();
  });

  it('refuses an action whose search the person has since changed by hand', () => {
    // #519 §8.8: "Si el usuario cambia un filtro manualmente después del
    // contexto enviado, ese cambio gana."
    expect(turnRefusal({ turnRevision: 7, currentRevision: 8 })).toBe('stale');
  });

  it('has nothing to compare before any turn start was seen', () => {
    expect(turnRefusal({ turnRevision: null, currentRevision: 8 })).toBeNull();
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
