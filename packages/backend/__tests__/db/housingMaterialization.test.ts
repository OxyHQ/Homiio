/**
 * `materializeHousingCandidate`, against a REAL Postgres server.
 *
 * A real server is not optional for any of this. `addresses.address_level` is a
 * GENERATED column, the identity and idempotency indexes are PARTIAL (so an
 * `ON CONFLICT` naming one either infers the right arbiter or fails at RUNTIME
 * with `42P10`, never at compile time), the SQLSTATE of a CHECK violation lives
 * on drizzle's `cause` rather than on the error it throws, and a failed
 * statement inside a transaction aborts the whole thing with `25P02`. None of
 * the four is observable against a mock: a mocked insert that rejects leaves no
 * aborted transaction behind, so a recovery path passes in the test and fails in
 * production.
 *
 * ## The fixtures are built to make the DISTINCTIONS visible
 *
 * Several assertions here would pass against a broken implementation if the
 * fixtures were tidier, and each is called out where it sits:
 *
 *  - the ambiguity zone needs a genuine near-duplicate (`42` versus
 *    `42, entrance A`) AND a control that must NOT be ambiguous (`43`), because
 *    a fixture set with no near-duplicate cannot tell "returned ambiguity
 *    correctly" from "found nothing";
 *  - the two-units-in-one-building case needs TWO units, because one unit's
 *    parent is the same row whether the hierarchy works or collapses;
 *  - the idempotency index needs an explicit-NULL fixture, because a suite whose
 *    calls all pass a key cannot tell a partial unique index from a total one;
 *  - the level derivation needs a row carrying `''`, which the writer can never
 *    produce, so it is inserted by raw SQL.
 */

import { eq, sql } from 'drizzle-orm';
import { constraintNameOf, uuidv7 } from '@oxyhq/db';

import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import {
  addressCandidates,
  addressExternalRefs,
  addressMaterializations,
  addresses,
  cities,
} from '../../db/schema';
import { findOrCreateCanonicalAddress } from '../../services/addressService';
import { deriveAddressLevel } from '../../services/addressIdentity';
import {
  materializeHousingCandidate,
  type HousingCandidateDraft,
  type MaterializationResult,
} from '../../services/housingMaterialization';

let db: Database;

/**
 * One city per RUN, and one per CASE.
 *
 * `city_id` is a hard equality filter in every lookup this module makes, so a
 * per-case city isolates each case completely — from a rerun, from a sibling
 * jest worker, and from the other cases in this file.
 *
 * That last one is not hypothetical. The first draft of this file put the run
 * token in the STREET names instead, so every street here shared a
 * 12-character substring; `pg_trgm` similarity between unrelated fixtures ran
 * 0.61-0.74, and three cases reported an ambiguity that had nothing to do with
 * what they were testing. Street names are therefore realistic and the isolation
 * lives in the city.
 */
const SUITE = uuidv7().slice(-12);
let caseIndex = 0;
function nextCity(): string {
  caseIndex += 1;
  return `Materializeville ${SUITE} ${caseIndex}`;
}

/** Barcelona-ish, so distances between fixtures are metres rather than degrees. */
const BASE_POINT = { longitude: 2.17, latitude: 41.39 };

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

/**
 * A candidate with every geo NAME the geocoder would otherwise be asked for.
 *
 * `city`, `state` and `countryCode` together make `resolveGeoNames`
 * short-circuit, so nothing in this file makes a network call — the same
 * arrangement `reviewAddressHierarchy.test.ts` relies on.
 */
function draft(city: string, overrides: Partial<HousingCandidateDraft> = {}): HousingCandidateDraft {
  return {
    provider: 'osm',
    rawText: 'Carrer de Provença 42, Barcelona',
    origin: 'geocoder',
    precision: 'exact',
    longitude: BASE_POINT.longitude,
    latitude: BASE_POINT.latitude,
    proposedCity: city,
    proposedRegion: 'Catalonia',
    proposedCountry: 'Spain',
    proposedCountryCode: 'ES',
    proposedStreet: 'Carrer de Provença',
    proposedPostalCode: '08013',
    ...overrides,
  };
}

/** Materialize under a listing upsert, the ordinary durable action. */
function materialize(
  candidate: HousingCandidateDraft,
  extra: { idempotencyKey?: string; confirmedAddressId?: string } = {},
): Promise<MaterializationResult> {
  return materializeHousingCandidate(
    { candidate, confirmedAddressId: extra.confirmedAddressId },
    {
      action: 'listing_upsert',
      actorOxyUserId: `oxy-${SUITE}`,
      idempotencyKey: extra.idempotencyKey,
    },
  );
}

/** Narrow to the success branch, failing loudly with the actual status. */
function expectMaterialized(result: MaterializationResult) {
  if (result.status !== 'materialized') {
    throw new Error(
      `expected a materialized result, got ${result.status}: ${JSON.stringify(result)}`,
    );
  }
  return result;
}

async function addressRow(id: string) {
  const [row] = await db.select().from(addresses).where(eq(addresses.id, id)).limit(1);
  return row;
}

/** Every address in one CITY, at any level. Scoped, so no other case leaks in. */
async function addressCountInCity(city: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(addresses)
    .innerJoin(cities, eq(addresses.cityId, cities.id))
    .where(eq(cities.name, city));
  return Number(rows[0]?.count ?? 0);
}

/** Every address in one city carrying `entrance`, for the "wrote nothing" checks. */
async function addressesWithEntranceInCity(city: string, entrance: string) {
  return db
    .select({ id: addresses.id })
    .from(addresses)
    .innerJoin(cities, eq(addresses.cityId, cities.id))
    .where(sql`${cities.name} = ${city} and ${addresses.entrance} = ${entrance}`);
}

describe('the candidate → canonical boundary', () => {
  it('creates the street → building → unit chain in order, with stored parents', async () => {
    const city = nextCity();
    const result = expectMaterialized(
      await materialize(
        draft(city, {
          proposedStreet: 'Carrer de Provença',
          proposedNumber: '42',
          proposedFloor: '3r',
          proposedUnit: '1a',
        }),
      ),
    );

    expect(result.addressLevel).toBe('UNIT');
    expect(result.unitAddressId).toBe(result.addressId);
    expect(result.buildingAddressId).not.toBeNull();
    expect(result.streetAddressId).not.toBe(result.buildingAddressId);
    expect(result.match.matchKind).toBe('created');

    const unit = await addressRow(result.addressId);
    const building = await addressRow(result.buildingAddressId ?? '');
    const streetRow = await addressRow(result.streetAddressId);

    // The LEVELS are what the database computed, not what this code asserted.
    expect(unit.addressLevel).toBe('UNIT');
    expect(building.addressLevel).toBe('BUILDING');
    expect(streetRow.addressLevel).toBe('STREET');

    // The hierarchy is STORED, which is the whole point of `parent_address_id`.
    expect(unit.parentAddressId).toBe(building.id);
    expect(building.parentAddressId).toBe(streetRow.id);
    expect(streetRow.parentAddressId).toBeNull();

    // Only the identifying fields for each level are carried down.
    expect(building.floor).toBeNull();
    expect(streetRow.number).toBeNull();

    // The provenance record exists and names the action that authorised it.
    const [provenance] = await db
      .select()
      .from(addressMaterializations)
      .where(eq(addressMaterializations.id, result.materializationId));
    expect(provenance.durableAction).toBe('listing_upsert');
    expect(provenance.candidateId).toBe(result.candidateId);
    expect(provenance.addressId).toBe(result.addressId);
    // Copied BY VALUE, so the audit survives the candidate's expiry sweep.
    expect(provenance.rawText).toBe('Carrer de Provença 42, Barcelona');
    expect(provenance.normalizationVersion).toBeGreaterThan(0);
  });

  it('gives two units of one building two identities and one shared parent', async () => {
    // THE discriminating fixture for ADR 0001 §1.3. Under the v1 key these two
    // are ONE row, because `floor` decides the level and is absent from that
    // key — and one unit alone cannot show it, since its parent is the same row
    // whether the hierarchy works or collapses.
    const city = nextCity();
    const first = expectMaterialized(
      await materialize(
        draft(city, { proposedStreet: 'Carrer de Provença', proposedNumber: '42', proposedFloor: '3r' }),
      ),
    );
    const second = expectMaterialized(
      await materialize(
        draft(city, { proposedStreet: 'Carrer de Provença', proposedNumber: '42', proposedFloor: '4t' }),
      ),
    );

    expect(second.addressId).not.toBe(first.addressId);
    expect(second.buildingAddressId).toBe(first.buildingAddressId);
    expect(second.streetAddressId).toBe(first.streetAddressId);

    const rows = await db
      .select({ id: addresses.id, level: addresses.addressLevel, floor: addresses.floor })
      .from(addresses)
      .where(eq(addresses.parentAddressId, first.buildingAddressId ?? ''));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.floor).sort()).toEqual(['3r', '4t']);
    expect(rows.every((row) => row.level === 'UNIT')).toBe(true);
  });

  it('gives two entrances of one address two buildings under one street', async () => {
    // The other half of the same defect: `entrance` decides the level and is
    // absent from the v1 key, so `100 Esc. A` and `100 Esc. B` are one row today.
    const city = nextCity();
    const a = expectMaterialized(
      await materialize(
        draft(city, { proposedStreet: 'Avinguda del Mar', proposedNumber: '100', proposedEntrance: 'A' }),
      ),
    );
    const b = expectMaterialized(
      await materialize(
        draft(city, { proposedStreet: 'Avinguda del Mar', proposedNumber: '100', proposedEntrance: 'B' }),
      ),
    );

    expect(b.addressId).not.toBe(a.addressId);
    expect(b.streetAddressId).toBe(a.streetAddressId);
    expect((await addressRow(a.addressId)).addressLevel).toBe('BUILDING');
    expect((await addressRow(b.addressId)).addressLevel).toBe('BUILDING');
  });

  it('folds a doubled space, a trailing space, case and an accent onto one identity', async () => {
    // ADR 0001 §10.10. The v1 key already folds case and a trailing space and
    // SPLITS on an internal double space, so the fourth spelling is the one that
    // discriminates v2 from v1 — a fixture set without it would pass either way.
    const city = nextCity();
    const ids = new Set<string>();
    for (const buildingName of ['Torre Mapfre', 'torre mapfre', 'Torre Mapfre ', 'Torré  Mapfre']) {
      const result = expectMaterialized(
        await materialize(
          draft(city, { proposedStreet: 'Avinguda del Port', proposedBuildingName: buildingName }),
        ),
      );
      ids.add(result.addressId);
    }
    expect(ids.size).toBe(1);
  });

  it('keeps a roman-numeral pair apart', async () => {
    // The control for the case above, and the reason normalization stops where
    // it does: `Torre Mapfre I` and `Torre Mapfre II` are two real buildings in
    // one development, so a normalizer aggressive enough to merge them would
    // trade a split for a much worse merge.
    const city = nextCity();
    const one = expectMaterialized(
      await materialize(
        draft(city, { proposedStreet: 'Avinguda dels Romans', proposedBuildingName: 'Torre Mapfre I' }),
      ),
    );
    const two = await materialize(
      draft(city, { proposedStreet: 'Avinguda dels Romans', proposedBuildingName: 'Torre Mapfre II' }),
    );
    // `Torre Mapfre I` and `Torre Mapfre II` are COMPATIBLE only if one side is
    // absent, and both name a building — so this is not even an ambiguity.
    expect(two.status).toBe('materialized');
    if (two.status !== 'materialized') throw new Error('unreachable');
    expect(two.addressId).not.toBe(one.addressId);
  });
});

describe('idempotency and concurrency', () => {
  it('returns the same entity for the same candidate confirmed twice', async () => {
    const city = nextCity();
    const first = expectMaterialized(
      await materialize(draft(city, { proposedStreet: 'Carrer de Balmes', proposedNumber: '7' })),
    );
    const second = expectMaterialized(
      await materialize(draft(city, { proposedStreet: 'Carrer de Balmes', proposedNumber: '7' })),
    );

    expect(second.addressId).toBe(first.addressId);
    expect(second.match.matchKind).toBe('exact_identity_key');
    // Two candidates — a candidate is an EVENT and is deliberately not deduped
    // globally (ADR 0001 §2.2) — and one place, plus its street.
    expect(second.candidateId).not.toBe(first.candidateId);
    expect(await addressCountInCity(city)).toBe(2);
  });

  it('collapses two calls carrying one idempotency key onto one materialization', async () => {
    const city = nextCity();
    const key = `idem-${SUITE}`;
    const first = expectMaterialized(
      await materialize(draft(city, { proposedStreet: 'Carrer de Muntaner', proposedNumber: '9' }), {
        idempotencyKey: key,
      }),
    );
    // A DIFFERENT address in the second call, so the replay is demonstrably keyed
    // on the idempotency key rather than on the two candidates being identical.
    const second = expectMaterialized(
      await materialize(draft(city, { proposedStreet: 'Carrer de Muntaner', proposedNumber: '11' }), {
        idempotencyKey: key,
      }),
    );

    expect(second.addressId).toBe(first.addressId);
    expect(second.materializationId).toBe(first.materializationId);

    const rows = await db
      .select({ id: addressMaterializations.id })
      .from(addressMaterializations)
      .where(eq(addressMaterializations.idempotencyKey, key));
    expect(rows).toHaveLength(1);
  });

  it('permits any number of materializations with NO idempotency key', async () => {
    // The explicit-NULL fixture. `address_materializations_idempotency_key` is
    // PARTIAL, so NULLs coexist; a TOTAL unique index would satisfy every
    // "rejects a duplicate key" assertion above and fail exactly here — which is
    // the direction `CONVENTIONS.md` records as the one a suite usually cannot
    // see.
    const city = nextCity();
    const ids: string[] = [];
    for (const number of ['1', '2', '3']) {
      const result = expectMaterialized(
        await materialize(draft(city, { proposedStreet: 'Carrer de Girona', proposedNumber: number })),
      );
      ids.push(result.materializationId);
    }
    const rows = await db
      .select({ id: addressMaterializations.id, key: addressMaterializations.idempotencyKey })
      .from(addressMaterializations)
      .where(sql`${addressMaterializations.id} in ${ids}`);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.key === null)).toBe(true);
  });

  it('converges when two requests for one dwelling race', async () => {
    const city = nextCity();
    const candidate = { proposedStreet: 'Carrer de la Cursa', proposedNumber: '5' };
    const [a, b] = await Promise.all([
      materialize(draft(city, candidate)),
      materialize(draft(city, candidate)),
    ]);
    const first = expectMaterialized(a);
    const second = expectMaterialized(b);
    expect(second.addressId).toBe(first.addressId);
    expect(await addressCountInCity(city)).toBe(2);
  });
});

describe('ambiguity is returned, never guessed', () => {
  it('refuses to decide between a building and the same building with an entrance', async () => {
    const city = nextCity();
    const existing = expectMaterialized(
      await materialize(draft(city, { proposedStreet: 'Carrer del Rosselló', proposedNumber: '42' })),
    );

    // The genuine near-duplicate: every identifying field is COMPATIBLE (the
    // stored row names no entrance), so nothing contradicts the claim that these
    // are one place — and nothing establishes it either.
    const ambiguous = await materialize(
      draft(city, {
        proposedStreet: 'Carrer del Rosselló',
        proposedNumber: '42',
        proposedEntrance: 'A',
      }),
    );

    expect(ambiguous.status).toBe('ambiguous');
    if (ambiguous.status !== 'ambiguous') throw new Error('unreachable');
    expect(ambiguous.candidates.map((c) => c.addressId)).toContain(existing.addressId);
    // Refusing to decide must not leave a row behind.
    expect(await addressesWithEntranceInCity(city, 'a')).toHaveLength(0);
  });

  it('does NOT call two different numbers on one street ambiguous', async () => {
    // The control, and the reason the ambiguity zone is usable at all: without
    // the compatibility rule EVERY address on a street would be ambiguous, and
    // the assertion above would pass for entirely the wrong reason.
    const city = nextCity();
    const first = expectMaterialized(
      await materialize(draft(city, { proposedStreet: 'Carrer del Rosselló', proposedNumber: '42' })),
    );
    const second = await materialize(
      draft(city, { proposedStreet: 'Carrer del Rosselló', proposedNumber: '43' }),
    );

    expect(second.status).toBe('materialized');
    if (second.status !== 'materialized') throw new Error('unreachable');
    expect(second.addressId).not.toBe(first.addressId);
    expect(second.streetAddressId).toBe(first.streetAddressId);
  });

  it('accepts a confirmation and creates no rival row beside it', async () => {
    const city = nextCity();
    const existing = expectMaterialized(
      await materialize(draft(city, { proposedStreet: 'Carrer de Casanova', proposedNumber: '42' })),
    );
    const before = await addressCountInCity(city);

    const confirmed = expectMaterialized(
      await materialize(
        draft(city, {
          proposedStreet: 'Carrer de Casanova',
          proposedNumber: '42',
          proposedEntrance: 'A',
        }),
        { confirmedAddressId: existing.addressId },
      ),
    );

    expect(confirmed.addressId).toBe(existing.addressId);
    expect(confirmed.match.matchKind).toBe('confirmed_probable');
    // The confirmed row's OWN fields are authoritative, so `entrance A` did not
    // acquire a building of its own. Without that rule this count would be one
    // higher and the assertion above would still pass.
    expect(await addressCountInCity(city)).toBe(before);
    expect(await addressesWithEntranceInCity(city, 'a')).toHaveLength(0);
  });
});

describe('conflicts are refused, never overwritten', () => {
  it('refuses to move a provider ref that already names another place', async () => {
    const city = nextCity();
    const ref = `ref-${SUITE}`;
    const first = expectMaterialized(
      await materialize(
        draft(city, { proposedStreet: 'Carrer de Balmes', proposedNumber: '1', providerRef: ref }),
      ),
    );

    // A different street AND a different number, so the ref'd row is not even a
    // probable match: the portal is claiming one id for two distinct places.
    const conflict = await materialize(
      draft(city, { proposedStreet: 'Avinguda Diagonal', proposedNumber: '2', providerRef: ref }),
    );

    expect(conflict.status).toBe('conflict');
    if (conflict.status !== 'conflict') throw new Error('unreachable');
    expect(conflict.conflicts[0].kind).toBe('provider_ref_bound_elsewhere');
    expect(conflict.conflicts[0].existingAddressId).toBe(first.addressId);

    // The ref still names the FIRST place — a silent move is the failure this
    // refusal exists to prevent — and the second place was never created, since
    // the conflict is decided before anything is written.
    const [refRow] = await db
      .select()
      .from(addressExternalRefs)
      .where(eq(addressExternalRefs.externalId, ref));
    expect(refRow.addressId).toBe(first.addressId);
    const diagonal = await db
      .select({ id: addresses.id })
      .from(addresses)
      .innerJoin(cities, eq(addresses.cityId, cities.id))
      .where(sql`${cities.name} = ${city} and ${addresses.street} = 'avinguda diagonal'`);
    expect(diagonal).toHaveLength(0);
  });

  it('lets a provider ref survive the portal relabelling the same place', async () => {
    const city = nextCity();
    const ref = `stable-${SUITE}`;
    const first = expectMaterialized(
      await materialize(
        draft(city, { proposedStreet: 'Carrer de Provença', proposedNumber: '3', providerRef: ref }),
      ),
    );

    // Same ref, same number, same point — the portal has started spelling the
    // street with a `z`. Identity by text no longer matches; the ref does, and
    // the row it names is still a probable match, so the ref wins.
    const again = expectMaterialized(
      await materialize(
        draft(city, { proposedStreet: 'Carrer de Provenza', proposedNumber: '3', providerRef: ref }),
      ),
    );
    expect(again.addressId).toBe(first.addressId);
    expect(again.match.matchKind).toBe('exact_external_ref');

    const [refRow] = await db
      .select()
      .from(addressExternalRefs)
      .where(eq(addressExternalRefs.externalId, ref));
    // `first_seen_at` records when Homiio FIRST saw the identifier and must not
    // be re-stamped; `last_seen_at` moves.
    expect(refRow.lastSeenAt.getTime()).toBeGreaterThanOrEqual(refRow.firstSeenAt.getTime());
  });
});

describe('validation refuses a permanent identity it cannot justify', () => {
  it('refuses to materialize a building from a city centroid, and keeps the candidate', async () => {
    // ADR 0001 §10.6: materializing from a centroid collapses every listing in
    // one city onto a fabricated building that then accumulates reviews about
    // unrelated flats. 94-100% of habitaclia and fotocasa listings carry one.
    const city = nextCity();
    const result = await materialize(
      draft(city, { proposedStreet: 'Carrer del Centroide', proposedNumber: '8', precision: 'centroid' }),
    );

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('unreachable');
    expect(result.reason).toBe('imprecise_location');

    // The candidate SURVIVES — that is what lets the listing be ingested and
    // shown at city scope rather than dropped.
    const [candidate] = await db
      .select()
      .from(addressCandidates)
      .where(eq(addressCandidates.id, result.candidateId));
    expect(candidate.materializedAddressId).toBeNull();
    expect(candidate.rawText).toBe('Carrer de Provença 42, Barcelona');
    expect(await addressCountInCity(city)).toBe(0);
  });

  it('refuses a candidate with no street', async () => {
    const result = await materialize(draft(nextCity(), { proposedStreet: '   ' }));
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('unreachable');
    expect(result.reason).toBe('missing_street');
  });

  it('refuses a candidate with no coordinates', async () => {
    const result = await materialize(
      draft(nextCity(), { proposedStreet: 'Carrer Sense Punt', longitude: null, latitude: null }),
    );
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('unreachable');
    expect(result.reason).toBe('missing_coordinates');
  });

  it('lets the CHECK refuse an out-of-range coordinate, naming the constraint', async () => {
    // Barcelona TRANSPOSED is a perfectly valid point in Turkey, which no range
    // check can catch — so the fixture uses a pair that transposition makes out
    // of range, which is the case the constraint exists for. PostGIS coerces
    // latitude 200 into range with a NOTICE and SUCCEEDS, turning a bad
    // coordinate into a different, entirely plausible place.
    //
    // The SQLSTATE is read through `constraintNameOf`, never off `error.code`:
    // drizzle WRAPS the driver error, so the code lives on `cause` and a check
    // written against the driver's own shape answers `undefined` for every real
    // violation.
    let caught: unknown;
    try {
      await materialize(
        draft(nextCity(), {
          proposedStreet: 'Carrer Transposat',
          longitude: 41.39,
          latitude: 200,
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(constraintNameOf(caught)).toBe('address_candidates_coordinates_check');
  });
});

describe('living beside the v1 key', () => {
  it('adopts a pre-v2 row rather than creating a rival beside it', async () => {
    // A row written the way every existing caller writes one: a v1
    // `normalized_key` and no `identity_key`, exactly like the 11,734 rows in
    // production.
    const city = nextCity();
    const legacy = await findOrCreateCanonicalAddress({
      // ACCENTED, which is the case that matters: v1 lowercases and trims but
      // does NOT strip diacritics, so this row's `normalized_key` hashes
      // `carrer de provença` while the v2 normalization of the same candidate
      // hashes `carrer de provenca`. Looking up only the stripped form would
      // adopt nothing and create a rival row beside every accented street in the
      // corpus — measured, on this exact case, before `legacyKeyCandidates`
      // existed.
      street: 'Carrer de Provença',
      number: '21',
      postal_code: '08013',
      city,
      state: 'Catalonia',
      country: 'Spain',
      countryCode: 'ES',
      coordinates: { type: 'Point', coordinates: [BASE_POINT.longitude, BASE_POINT.latitude] },
    });
    expect(legacy.identityKey).toBeNull();

    const result = expectMaterialized(
      await materialize(draft(city, { proposedStreet: 'Carrer de Provença', proposedNumber: '21' })),
    );
    expect(result.addressId).toBe(legacy.id);
    expect(result.match.matchKind).toBe('adopted_v1_key');

    const adopted = await addressRow(legacy.id);
    expect(adopted.identityKey).not.toBeNull();
    // The v1 key is untouched, so every existing caller still resolves to it.
    expect(adopted.normalizedKey).toBe(legacy.normalizedKey);
  });

  it('creates a row with a NULL v1 key when v1 cannot tell two places apart', async () => {
    // The collapse case. A building and a floor-only flat hash to ONE v1 key,
    // and `addresses_normalized_key_key` is unique — so the second row cannot
    // carry one. NULL is the honest answer, and it is what lets the two exist.
    const city = nextCity();
    const building = expectMaterialized(
      await materialize(draft(city, { proposedStreet: 'Carrer de Sardenya', proposedNumber: '33' })),
    );
    const flat = expectMaterialized(
      await materialize(
        draft(city, { proposedStreet: 'Carrer de Sardenya', proposedNumber: '33', proposedFloor: '2n' }),
      ),
    );

    expect(flat.addressId).not.toBe(building.addressId);
    const flatRow = await addressRow(flat.addressId);
    const buildingRow = await addressRow(building.addressId);
    expect(buildingRow.normalizedKey).not.toBeNull();
    expect(flatRow.normalizedKey).toBeNull();
    expect(flatRow.identityKey).not.toBeNull();
    expect(flatRow.addressLevel).toBe('UNIT');
  });
});

describe('the merge redirect is honoured before it is ever written', () => {
  it('returns the survivor when a matched row has been merged away', async () => {
    const city = nextCity();
    const loser = expectMaterialized(
      await materialize(draft(city, { proposedStreet: 'Carrer de Aribau', proposedNumber: '61' })),
    );
    const survivor = expectMaterialized(
      await materialize(draft(city, { proposedStreet: 'Carrer de Aribau', proposedNumber: '62' })),
    );

    // Nothing performs a merge yet, so the pointer is written directly — which
    // is the point of the case: the matcher must already follow it, or the day
    // merge lands it starts handing callers a row the merge retired.
    await db
      .update(addresses)
      .set({ mergedIntoAddressId: survivor.addressId })
      .where(eq(addresses.id, loser.addressId));

    const again = expectMaterialized(
      await materialize(draft(city, { proposedStreet: 'Carrer de Aribau', proposedNumber: '61' })),
    );
    expect(again.addressId).toBe(survivor.addressId);
  });
});

describe('the TypeScript level derivation agrees with the generated column', () => {
  it('answers identically for every discriminating shape, including an empty string', async () => {
    // `deriveAddressLevel` is a TypeScript copy of a `GENERATED ALWAYS`
    // predicate, and a copy can drift silently. The `''` rows are the cases the
    // service can never produce (`identityValueOrNull` writes NULL), so they are
    // inserted by raw SQL — and they are exactly where `is not null` and
    // `coalesce(x, '') <> ''` disagree.
    const city = nextCity();
    const anchor = await materialize(
      draft(city, { proposedStreet: 'Carrer Derivació', proposedNumber: '1' }),
    );
    const anchorRow = await addressRow(expectMaterialized(anchor).addressId);

    const shapes = [
      { label: 'street only', number: null, floor: null },
      { label: 'number', number: '5', floor: null },
      { label: 'floor', number: '5', floor: '3r' },
      { label: 'empty-string floor', number: '5', floor: '' },
      { label: 'empty-string number', number: '', floor: null },
    ];

    const observed: string[][] = [];
    const expected: string[][] = [];
    for (const shape of shapes) {
      const id = uuidv7();
      await db.execute(sql`
        insert into addresses (
          id, country_id, region_id, city_id, country_code, street, postal_code,
          number, floor, longitude, latitude
        ) values (
          ${id}, ${anchorRow.countryId}, ${anchorRow.regionId}, ${anchorRow.cityId},
          ${anchorRow.countryCode}, 'carrer derivacio', '08013',
          ${shape.number}, ${shape.floor}, ${BASE_POINT.longitude}, ${BASE_POINT.latitude}
        )
      `);
      const [row] = await db
        .select({ level: addresses.addressLevel })
        .from(addresses)
        .where(eq(addresses.id, id));
      observed.push([shape.label, row.level ?? 'null']);
      expected.push([
        shape.label,
        deriveAddressLevel({
          street: 'carrer derivacio',
          postalCode: '08013',
          cityId: anchorRow.cityId,
          countryCode: anchorRow.countryCode,
          number: shape.number,
          floor: shape.floor,
        }),
      ]);
    }

    // Compared as whole lists, so a failure names WHICH shape disagreed rather
    // than merely that one did.
    expect(expected).toEqual(observed);
    // Vacuity floor: an empty loop would satisfy the assertion above.
    expect(observed).toHaveLength(5);
    expect(observed.map((row) => row[1])).toEqual([
      'STREET',
      'BUILDING',
      'UNIT',
      'BUILDING',
      'STREET',
    ]);
  });
});
