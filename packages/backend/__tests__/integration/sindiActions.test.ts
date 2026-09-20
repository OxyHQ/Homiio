/**
 * Deriving a Sindi action from a turn, against a real Postgres (#519 §8.5).
 *
 * The city resolution goes through `lookupCityPlaces`, which is SQL and whose
 * whole value is the four-outcome contract — resolved, ambiguous, not found,
 * never a silently chosen row. A mocked database would assert the mock's
 * opinion of homonyms, which is the one thing worth testing here.
 */

import { resetGeoTables, seedGeoChain } from '../helpers/postgresGeoFixtures';
import {
  actionEnvelopeForTurn,
  parseAppContext,
  parseTurnId,
  searchOutcomeForTurn,
} from '../../services/sindiActions';
import { parseSindiAction, type SindiAppContext } from '@homiio/shared-types';

const context = (overrides: Partial<SindiAppContext> = {}): SindiAppContext => ({
  revision: 42,
  presentation: 'side_by_side',
  destination: 'home',
  ...overrides,
});

beforeEach(async () => {
  await resetGeoTables();
});

describe('a turn only becomes an action when the person asked for listings', () => {
  it('produces nothing for a turn that is not about finding homes', async () => {
    // "Cuéntame cómo es Granollers" extracts a city and is NOT a search. An
    // assistant that navigated here would move the app under somebody who
    // asked a question.
    expect((await searchOutcomeForTurn({ wantsListings: false, city: 'Granollers' })).patch).toBeNull();
  });

  it('produces nothing for a rights question, which extracts no filters at all', async () => {
    expect((await searchOutcomeForTurn({ wantsListings: false })).patch).toBeNull();
  });

  it('produces a patch when the person asked and named a constraint', async () => {
    const { patch } = await searchOutcomeForTurn({ wantsListings: true, maxRent: 1200, bedrooms: 2 });
    expect(patch).toEqual({ priceMax: 1200, bedrooms: 2 });
  });
});

describe('the area is resolved, never guessed', () => {
  it('resolves an unambiguous city to a Homiio-owned selection', async () => {
    const chain = await seedGeoChain({
      countryCode: 'ES',
      regionName: 'Catalonia',
      cityName: 'Granollers',
      latitude: 41.6083,
      longitude: 2.2874,
    });

    const { patch } = await searchOutcomeForTurn({ wantsListings: true, city: 'Granollers' });

    expect(patch?.location?.kind).toBe('place');
    if (patch?.location?.kind !== 'place') return;
    // The same identity a hand-typed pick produces, so the `loc` token, the
    // query key and the cache entry all agree.
    expect(patch.location.source).toEqual({ kind: 'homiio', entity: 'city', id: chain.cityId });
  });

  it('refuses a homonym rather than picking one, and names what it refused', async () => {
    // There is a Barcelona in Catalonia and one in Anzoátegui. Taking the first
    // is the bug ADR 0002 §12.2 exists for; the right answer is to let Sindi's
    // prose ask which one, and leave the app where it is.
    //
    // BOTH carry listings, and that is load-bearing. `resolveCity` discounts a
    // candidate holding nothing — a place with no listings cannot answer a
    // question about listings there — so a fixture where both were empty would
    // pass this case for the wrong reason: refused as empty rather than refused
    // as ambiguous.
    const spain = await seedGeoChain({
      countryCode: 'ES',
      countryName: 'Spain',
      regionName: 'Catalonia',
      cityName: 'Barcelona',
      propertiesCount: 12,
      latitude: 41.3874,
      longitude: 2.1686,
    });
    await seedGeoChain({
      countryCode: 'VE',
      countryName: 'Venezuela',
      regionName: 'Anzoátegui',
      cityName: 'Barcelona',
      propertiesCount: 4,
      latitude: 10.1339,
      longitude: -64.6836,
    });

    const { patch, unresolvedPlace } = await searchOutcomeForTurn({
      wantsListings: true,
      city: 'Barcelona',
      maxRent: 900,
    });

    // AMENDED: this used to assert `patch.priceMax === 900` beside an absent
    // location — "the rest of the turn still applies". It does not. "Under 900"
    // was said about Barcelona, and narrowing whatever city was already on
    // screen to 900 answers confidently about the wrong place.
    expect(patch).toBeNull();
    expect(unresolvedPlace).toEqual({ requested: 'Barcelona', reason: 'ambiguous' });
    expect(spain.cityId).toBeTruthy();
  });

  it('resolves past DUPLICATE rows for one city, which is what production has', async () => {
    // Production carries three `cities` rows named Barcelona in Spain — with
    // the slug `barcelona` on all three — and two of them hold zero listings.
    // Refusing them made the most ordinary request Sindi can receive — "show me
    // flats in Barcelona" — produce no location, and with no other constraint
    // in the sentence, no action at all: the person saw nothing happen and
    // nothing said.
    //
    // The fixture is three separate CHAINS because production's three rows are
    // in three separate REGIONS — `Catalonia`, `Barcelona` and `barcelona`. It
    // reproduces the live shape rather than approximating it. An earlier
    // version of this comment said the three chains were merely what survived
    // migration 0029; that was wrong. 0029 folds duplicates INSIDE one region
    // and never saw these, so `cities_region_slug_key` cannot remove this case
    // — several candidates for one slug across regions is what ADR 0002 §12.2
    // says is legal and must stay legal. Which is exactly why the empty-row
    // rule, and not the index, is what this test guards.
    const real = await seedGeoChain({
      countryCode: 'ES',
      countryName: 'Spain',
      regionName: 'Catalonia',
      cityName: 'Barcelona',
      propertiesCount: 9,
      latitude: 41.3874,
      longitude: 2.1686,
    });
    // The lower-cased twin, in a second region of the same country.
    await seedGeoChain({
      countryCode: 'E2',
      countryName: 'Spain (second chain)',
      regionName: 'Catalonia',
      cityName: 'barcelona',
      propertiesCount: 0,
    });
    await seedGeoChain({
      countryCode: 'E3',
      countryName: 'Spain (third chain)',
      regionName: 'Barcelona Province',
      cityName: 'Barcelona',
      propertiesCount: 0,
    });

    const { patch } = await searchOutcomeForTurn({ wantsListings: true, city: 'Barcelona' });

    expect(patch?.location?.kind).toBe('place');
    if (patch?.location?.kind !== 'place') return;
    // The one that actually holds homes, and not by a popularity tiebreak —
    // the other two were never candidates, because a row holding nothing is not
    // a possible answer to "what is in it".
    expect(patch.location.source).toEqual({ kind: 'homiio', entity: 'city', id: real.cityId });
  });

  it('still refuses when TWO candidates hold listings', async () => {
    // The rule discounts empty rows; it does not choose between full ones. Two
    // real places that both have homes stay ambiguous, which is the case the
    // homonym rule exists to protect and a popularity tiebreak would get wrong.
    await seedGeoChain({
      countryCode: 'ES',
      countryName: 'Spain',
      regionName: 'Catalonia',
      cityName: 'Barcelona',
      propertiesCount: 9,
    });
    await seedGeoChain({
      countryCode: 'VE',
      countryName: 'Venezuela',
      regionName: 'Anzoátegui',
      cityName: 'Barcelona',
      propertiesCount: 1,
    });
    await seedGeoChain({
      countryCode: 'E4',
      countryName: 'Spain (empty twin)',
      regionName: 'Catalonia',
      cityName: 'Barcelona',
      propertiesCount: 0,
    });

    const { patch, unresolvedPlace } = await searchOutcomeForTurn({
      wantsListings: true,
      city: 'Barcelona',
      maxRent: 900,
    });

    expect(patch).toBeNull();
    expect(unresolvedPlace).toEqual({ requested: 'Barcelona', reason: 'ambiguous' });
  });

  it('uses the region to disambiguate when the person supplied one', async () => {
    await seedGeoChain({
      countryCode: 'ES',
      countryName: 'Spain',
      regionName: 'Catalonia',
      cityName: 'Barcelona',
      latitude: 41.3874,
      longitude: 2.1686,
    });
    await seedGeoChain({
      countryCode: 'VE',
      countryName: 'Venezuela',
      regionName: 'Anzoátegui',
      cityName: 'Barcelona',
      latitude: 10.1339,
      longitude: -64.6836,
    });

    const { patch } = await searchOutcomeForTurn({
      wantsListings: true,
      city: 'Barcelona',
      state: 'Catalonia',
    });

    expect(patch?.location?.kind).toBe('place');
  });

  it('refuses a city Homiio does not have, and says which one', async () => {
    const { patch, unresolvedPlace } = await searchOutcomeForTurn({
      wantsListings: true,
      city: 'Atlantis',
      maxRent: 700,
    });
    // The whole patch goes, not just its `location`. "Under 700" was said about
    // Atlantis, and applying it to whichever area happened to be in force is a
    // query whose location was requested and lost (ADR 0002 decision 5).
    expect(patch).toBeNull();
    expect(unresolvedPlace).toEqual({ requested: 'Atlantis', reason: 'not_found' });
  });
});

describe('the envelope', () => {
  it('carries the turn, the context revision and exactly one action', async () => {
    await seedGeoChain({ cityName: 'Granollers', latitude: 41.6083, longitude: 2.2874 });

    const envelope = await actionEnvelopeForTurn({
      turnId: 't1',
      appContext: context(),
      conversationId: 'c1',
      intent: { wantsListings: true, city: 'Granollers', maxRent: 1200 },
    });

    expect(envelope).not.toBeNull();
    if (!envelope) return;
    expect(envelope.turnId).toBe('t1');
    expect(envelope.contextRevision).toBe(42);
    expect(envelope.conversationId).toBe('c1');
    expect(envelope.action.kind).toBe('apply_search');
    // Unique per emission, so a replayed frame carries the same id and the
    // client applies it once.
    expect(envelope.actionId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('opens Explore when listings were asked for with nothing to filter on', async () => {
    const envelope = await actionEnvelopeForTurn({
      turnId: 't1',
      appContext: context(),
      intent: { wantsListings: true },
    });

    expect(envelope?.action).toEqual({ kind: 'navigate', destination: 'explore' });
  });

  it('does not re-open Explore when the user is already there', async () => {
    // KEPT, deliberately. This looks like the silent path and is not: reaching
    // it means the turn named NO place — one that named a place and lost it
    // emits `clarify_location` before this branch — so the request is "show me
    // homes" from somebody already standing in front of them. Pushing
    // `/explore` from `/explore` adds a back-stack entry, changes nothing on
    // screen, and reports "Done: open Explore" for it, which is the same lie
    // `parseSindiSearchPatch` refuses an empty patch to avoid.
    const envelope = await actionEnvelopeForTurn({
      turnId: 't1',
      appContext: context({ destination: 'explore' }),
      intent: { wantsListings: true },
    });

    expect(envelope).toBeNull();
  });

  it('emits nothing at all for a turn that asked nothing of the app', async () => {
    const envelope = await actionEnvelopeForTurn({
      turnId: 't1',
      appContext: context(),
      intent: { wantsListings: false, city: 'Granollers' },
    });

    expect(envelope).toBeNull();
  });
});

describe('the app context a client sends is validated, never trusted', () => {
  it('accepts a well-formed context', () => {
    expect(
      parseAppContext({
        revision: 7,
        presentation: 'chat_only',
        destination: 'explore',
        scopeLabel: 'Barcelona',
        priceMax: 1200,
      }),
    ).toEqual({
      revision: 7,
      presentation: 'chat_only',
      destination: 'explore',
      scopeLabel: 'Barcelona',
      priceMax: 1200,
    });
  });

  it.each([
    ['no revision', { presentation: 'chat_only', destination: null }],
    ['a fractional revision', { revision: 1.5, presentation: 'chat_only', destination: null }],
    ['an unknown presentation', { revision: 1, presentation: 'popover', destination: null }],
    ['an unknown destination', { revision: 1, presentation: 'chat_only', destination: '/admin' }],
    ['an array', []],
    ['null', null],
  ])('refuses %s', (_label, value) => {
    expect(parseAppContext(value)).toBeNull();
  });

  it('drops fields it does not recognise rather than passing them through', () => {
    const parsed = parseAppContext({
      revision: 1,
      presentation: 'chat_only',
      destination: null,
      // The things #519 §8.3 says may never travel. None of them has a home in
      // `SindiAppContext`, so they cannot survive parsing.
      ip: '203.0.113.5',
      coordinates: { lat: 41.3, lng: 2.1 },
      accessToken: 'secret',
      savedProperties: ['a', 'b'],
    });

    expect(parsed).toEqual({ revision: 1, presentation: 'chat_only', destination: null });
    expect(JSON.stringify(parsed)).not.toContain('203.0.113.5');
    expect(JSON.stringify(parsed)).not.toContain('secret');
  });
});

describe('the turn id a client sends is validated', () => {
  it('accepts a plain token', () => {
    expect(parseTurnId('t1abc')).toBe('t1abc');
  });

  it.each([['a path', '../x'], ['an empty string', ''], ['a number', 7], ['undefined', undefined]])(
    'refuses %s',
    (_label, value) => {
      expect(parseTurnId(value)).toBeNull();
    },
  );
});

describe('a place the turn NAMED and Homiio could not commit to is said out loud', () => {
  // ADR 0002 decision 5 and §4.3: "A failed resolution never runs a
  // location-less query", and §1.3(c) names the failure this suite pins — a
  // resolution failure that falls through to a global feed with "no signal
  // anywhere in the UI that the location was dropped". Emitting NOTHING is the
  // same failure with the signal turned down further: the person asked about a
  // specific place and the app neither went there nor said it could not.

  it('asks which place, rather than emitting nothing, when the name is a homonym', async () => {
    // Two real Barcelonas, both holding listings, so the empty-row rule cannot
    // settle it. Refusing to choose is correct (§12.2). Refusing SILENTLY is
    // the defect.
    await seedGeoChain({
      countryCode: 'ES',
      countryName: 'Spain',
      regionName: 'Catalonia',
      cityName: 'Barcelona',
      propertiesCount: 12,
    });
    await seedGeoChain({
      countryCode: 'VE',
      countryName: 'Venezuela',
      regionName: 'Anzoátegui',
      cityName: 'Barcelona',
      propertiesCount: 4,
    });

    const envelope = await actionEnvelopeForTurn({
      turnId: 't1',
      // Standing on /explore is the most common place to ask, and it is where
      // the old code had nothing left to emit at all.
      appContext: context({ destination: 'explore' }),
      intent: { wantsListings: true, city: 'Barcelona' },
    });

    expect(envelope?.action).toEqual({
      kind: 'clarify_location',
      requested: 'Barcelona',
      reason: 'ambiguous',
    });
  });

  it('says a named city is unknown rather than opening a worldwide Explore', async () => {
    // From anywhere but /explore the old code answered this with
    // `navigate: explore` — an unrestricted feed under a request for one place,
    // which is ADR 0002 §1.3(c) verbatim.
    const envelope = await actionEnvelopeForTurn({
      turnId: 't1',
      appContext: context({ destination: 'home' }),
      intent: { wantsListings: true, city: 'Atlantis' },
    });

    expect(envelope?.action).toEqual({
      kind: 'clarify_location',
      requested: 'Atlantis',
      reason: 'not_found',
    });
  });

  it('does not apply the turn’s other constraints to whatever area is in force', async () => {
    // "pisos en Hamburg por menos de 900" with Hamburg unresolved used to emit
    // `apply_search { priceMax: 900 }`, which narrows the PREVIOUS area and
    // reports "done" — a query whose location was requested and lost, which is
    // exactly what decision 5 forbids. One action per turn, so this is a
    // choice, and the named place is the load-bearing half of the sentence.
    await seedGeoChain({
      countryCode: 'ES',
      countryName: 'Spain',
      regionName: 'Catalonia',
      cityName: 'Barcelona',
      propertiesCount: 12,
    });
    await seedGeoChain({
      countryCode: 'VE',
      countryName: 'Venezuela',
      regionName: 'Anzoátegui',
      cityName: 'Barcelona',
      propertiesCount: 4,
    });

    const envelope = await actionEnvelopeForTurn({
      turnId: 't1',
      appContext: context({ destination: 'explore' }),
      intent: { wantsListings: true, city: 'Barcelona', maxRent: 900 },
    });

    expect(envelope?.action.kind).toBe('clarify_location');
  });

  it('carries a name the client’s own parser will accept', async () => {
    // The emitter and `parseSindiAction` share one bound. A name longer than
    // the contract allows would be dropped by the client, and a refusal the
    // client drops is the silence this whole suite is about, arriving one layer
    // further down.
    const long = 'A'.repeat(400);

    const envelope = await actionEnvelopeForTurn({
      turnId: 't1',
      appContext: context({ destination: 'explore' }),
      intent: { wantsListings: true, city: long },
    });

    expect(envelope?.action.kind).toBe('clarify_location');
    expect(parseSindiAction(envelope?.action)).toEqual(envelope?.action);
  });

  it('says nothing when the person was not asking for listings', async () => {
    // "Cuéntame cómo es Atlantis" names a place Homiio cannot resolve and asks
    // the app for nothing. A clarification here would be the assistant
    // interrupting a question with a question.
    const envelope = await actionEnvelopeForTurn({
      turnId: 't1',
      appContext: context({ destination: 'explore' }),
      intent: { wantsListings: false, city: 'Atlantis' },
    });

    expect(envelope).toBeNull();
  });

  it('still emits the search when the place did resolve', async () => {
    await seedGeoChain({ cityName: 'Granollers', latitude: 41.6083, longitude: 2.2874 });

    const envelope = await actionEnvelopeForTurn({
      turnId: 't1',
      appContext: context({ destination: 'explore' }),
      intent: { wantsListings: true, city: 'Granollers', maxRent: 1200 },
    });

    expect(envelope?.action.kind).toBe('apply_search');
  });
});
