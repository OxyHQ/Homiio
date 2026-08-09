/**
 * The COHERENCE checks — the constraints that say two columns must agree.
 *
 * Every one of them ports a rule this package already had and could not
 * enforce: a Mongoose `pre('save')` hook or a `validate`, both of which are
 * bypassed by `findOneAndUpdate`, which is how most of these tables are actually
 * written. So none of these is a new rule; each is an existing rule moved to
 * where an update cannot walk past it.
 *
 * ## Why they are asserted in BOTH directions
 *
 * Almost all of these are equivalences (`A = B`), and an implication (`A -> B`)
 * looks identical in a one-sided test. The two differ on exactly one input
 * shape, and it is usually the damaging one: a `cancelled` viewing that names
 * nobody, an `applied` enforcement with no timestamp, a `paid` instalment with
 * no payment. A file that only checks "the obviously wrong row is refused"
 * cannot tell an equivalence from an implication, so every case below also
 * inserts the row the constraint must PERMIT.
 *
 * Every table exercised here is EMPTY in production, which is what makes these
 * constraints expressible at all — `CONVENTIONS.md` defers a constraint that
 * could reject rows the census has not measured.
 */

import { eq, inArray, sql } from 'drizzle-orm';
import { CHECK_VIOLATION, constraintNameOf, sqlStateOf, uuidv7 } from '@oxyhq/db';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import {
  commissions,
  conversations,
  exchangeRequests,
  leasePaymentSchedule,
  leases,
  moderationEnforcements,
  moderationEvents,
  moderationOutbox,
  partners,
  placePoiCategories,
  placePois,
  properties,
  reviews,
  roommateRelationships,
  tenantApplications,
  viewingRequests,
} from '../../db/schema';
import {
  createPropertyScaffold,
  dropPropertyScaffold,
  insertProperty,
  type PropertyScaffold,
} from './propertyFixtures';

const oxy = (): string => `oxy-${uuidv7()}`;
const JAN = (day: number): Date => new Date(Date.UTC(2026, 0, day));

/** The SQLSTATE and constraint name of whatever `run` threw, or `undefined`s. */
async function violation(
  run: () => Promise<unknown>,
): Promise<{ state?: string; constraint?: string }> {
  try {
    await run();
    return {};
  } catch (error) {
    return { state: sqlStateOf(error), constraint: constraintNameOf(error) };
  }
}

let db: Database;
let scaffold: PropertyScaffold;
let propertyId: string;
let leaseId: string;

beforeAll(async () => {
  db = await connectPostgres();
  scaffold = await createPropertyScaffold(db, 'coherence');
  propertyId = await insertProperty(db, scaffold);
  const [lease] = await db
    .insert(leases)
    .values({
      propertyId,
      landlordOxyUserId: oxy(),
      tenantOxyUserId: oxy(),
      leaseTermsStartDate: JAN(1),
      leaseTermsEndDate: new Date(Date.UTC(2026, 11, 31)),
      rentDetailsMonthlyRent: 1200,
    })
    .returning({ id: leases.id });
  leaseId = lease.id;
});

afterAll(async () => {
  // Every one of these tables references `properties` with ON DELETE RESTRICT,
  // so a row a case failed to clean up makes the property delete throw — and
  // the suite then reports "failed to run" rather than naming the assertion that
  // actually went wrong. Clearing them by property id keeps a real failure
  // legible instead of hiding it behind a teardown error.
  await db.delete(exchangeRequests).where(eq(exchangeRequests.propertyId, propertyId));
  await db.delete(viewingRequests).where(eq(viewingRequests.propertyId, propertyId));
  await db.delete(tenantApplications).where(eq(tenantApplications.propertyId, propertyId));
  await db.delete(commissions).where(eq(commissions.propertyId, propertyId));
  await db.delete(leases).where(eq(leases.id, leaseId));
  await db.delete(properties).where(eq(properties.id, propertyId));
  await dropPropertyScaffold(db, scaffold);
  await closePostgres();
});

describe('lease_payment_schedule — a paid instalment carries the evidence', () => {
  const instalment = { leaseId: '', dueDate: JAN(1), amount: 1200, type: 'rent' as const };

  it('refuses `paid` with no payment date or amount', async () => {
    const { state, constraint } = await violation(() =>
      db.insert(leasePaymentSchedule).values({ ...instalment, leaseId, status: 'paid' }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('lease_payment_schedule_paid_evidence_check');
  });

  it('refuses a payment date on a `pending` instalment', async () => {
    // The other direction, and the one an implication-shaped constraint would
    // let through: a payment recorded against a row nobody marked paid is money
    // that never appears in a rent ledger.
    const { state, constraint } = await violation(() =>
      db
        .insert(leasePaymentSchedule)
        .values({ ...instalment, leaseId, paidDate: JAN(2), paidAmount: 1200 }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('lease_payment_schedule_paid_evidence_check');
  });

  it('accepts both coherent shapes', async () => {
    await expect(
      db.insert(leasePaymentSchedule).values([
        { ...instalment, leaseId },
        { ...instalment, leaseId, status: 'paid', paidDate: JAN(2), paidAmount: 1200 },
      ]),
    ).resolves.toBeDefined();
    await db.delete(leasePaymentSchedule).where(eq(leasePaymentSchedule.leaseId, leaseId));
  });
});

describe('viewing_requests — a cancellation names who cancelled', () => {
  const base = { propertyId: '', requesterOxyUserId: '', ownerOxyUserId: '', scheduledAt: JAN(5) };

  it('refuses `cancelled` with no canceller', async () => {
    const { state, constraint } = await violation(() =>
      db.insert(viewingRequests).values({
        ...base,
        propertyId,
        requesterOxyUserId: oxy(),
        ownerOxyUserId: oxy(),
        status: 'cancelled',
      }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('viewing_requests_cancelled_by_status_check');
  });

  it('refuses a canceller on a request that was not cancelled', async () => {
    const { state, constraint } = await violation(() =>
      db.insert(viewingRequests).values({
        ...base,
        propertyId,
        requesterOxyUserId: oxy(),
        ownerOxyUserId: oxy(),
        cancelledBy: 'owner',
      }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('viewing_requests_cancelled_by_status_check');
  });

  it('accepts a cancellation that names a side', async () => {
    const requester = oxy();
    await expect(
      db.insert(viewingRequests).values({
        ...base,
        propertyId,
        requesterOxyUserId: requester,
        ownerOxyUserId: oxy(),
        status: 'cancelled',
        cancelledBy: 'requester',
      }),
    ).resolves.toBeDefined();
    await db.delete(viewingRequests).where(eq(viewingRequests.requesterOxyUserId, requester));
  });
});

describe('tenant_applications — a decided application has a decision date', () => {
  const base = {
    moveInDate: JAN(20),
    leaseTermMonths: 12,
    monthlyIncome: 3000,
    employmentStatus: 'employed' as const,
    submittedAt: JAN(1),
  };

  it('refuses a terminal status with no `decided_at`', async () => {
    // `pre('save')` stamps it — and it is a SAVE hook, so `findOneAndUpdate`
    // walks straight past it. A rejected application with no decision date sorts
    // on a landlord's dashboard as if it were still open.
    const { state, constraint } = await violation(() =>
      db.insert(tenantApplications).values({
        ...base,
        propertyId,
        applicantOxyUserId: oxy(),
        landlordOxyUserId: oxy(),
        status: 'rejected',
      }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('tenant_applications_decided_at_check');
  });

  it('refuses a `decided_at` on an application still under review', async () => {
    const { state, constraint } = await violation(() =>
      db.insert(tenantApplications).values({
        ...base,
        propertyId,
        applicantOxyUserId: oxy(),
        landlordOxyUserId: oxy(),
        status: 'reviewing',
        decidedAt: JAN(3),
      }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('tenant_applications_decided_at_check');
  });

  it('accepts both coherent shapes, including all three terminal statuses', async () => {
    // The terminal SET matters as much as the rule: `withdrawn` is a terminal
    // status the frontend reaches, and a CHECK naming only `approved`/`rejected`
    // would reject a withdrawal that the hook stamped correctly.
    const applicant = oxy();
    await expect(
      db.insert(tenantApplications).values([
        { ...base, propertyId, applicantOxyUserId: applicant, landlordOxyUserId: oxy() },
        {
          ...base,
          propertyId,
          applicantOxyUserId: applicant,
          landlordOxyUserId: oxy(),
          status: 'approved',
          decidedAt: JAN(3),
        },
        {
          ...base,
          propertyId,
          applicantOxyUserId: applicant,
          landlordOxyUserId: oxy(),
          status: 'withdrawn',
          decidedAt: JAN(4),
        },
      ]),
    ).resolves.toBeDefined();
    await db
      .delete(tenantApplications)
      .where(eq(tenantApplications.applicantOxyUserId, applicant));
  });
});

describe('exchange_requests — a HOST request offers nothing', () => {
  const window = { requestedWindowStart: JAN(10), requestedWindowEnd: JAN(20) };

  it('refuses a host request that offers a property', async () => {
    // `pre('save')` clears it; `findOneAndUpdate` does not run `pre('save')`.
    // A host request carrying an offered property reads to the host as a swap
    // they never agreed to.
    const { state, constraint } = await violation(() =>
      db.insert(exchangeRequests).values({
        ...window,
        propertyId,
        requesterOxyUserId: oxy(),
        hostOxyUserId: oxy(),
        mode: 'host',
        offeredPropertyId: propertyId,
      }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('exchange_requests_host_mode_offers_nothing_check');
  });

  it('accepts a SWAP that offers one, and a host request that offers nothing', async () => {
    const requester = oxy();
    await expect(
      db.insert(exchangeRequests).values([
        {
          ...window,
          propertyId,
          requesterOxyUserId: requester,
          hostOxyUserId: oxy(),
          mode: 'swap',
          offeredPropertyId: propertyId,
          offeredWindowStart: JAN(10),
          offeredWindowEnd: JAN(20),
        },
        {
          ...window,
          propertyId,
          requesterOxyUserId: requester,
          hostOxyUserId: oxy(),
          mode: 'host',
        },
      ]),
    ).resolves.toBeDefined();
    await db.delete(exchangeRequests).where(eq(exchangeRequests.requesterOxyUserId, requester));
  });

  it('refuses half an offered window', async () => {
    const { state, constraint } = await violation(() =>
      db.insert(exchangeRequests).values({
        ...window,
        propertyId,
        requesterOxyUserId: oxy(),
        hostOxyUserId: oxy(),
        mode: 'swap',
        offeredWindowStart: JAN(10),
      }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('exchange_requests_offered_window_check');
  });
});

describe('conversations — the four sharing columns move together', () => {
  it('refuses a shared conversation with no token', async () => {
    const { state, constraint } = await violation(() =>
      db.insert(conversations).values({
        oxyUserId: oxy(),
        title: 'x',
        analyticsLastActivity: new Date(),
        sharingIsShared: true,
      }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('conversations_sharing_coherent_check');
  });

  it('refuses a live token on a conversation flagged unshared', async () => {
    // The dangerous direction: a token that still resolves while the UI shows
    // the conversation as private, so nobody can revoke it.
    const { state, constraint } = await violation(() =>
      db.insert(conversations).values({
        oxyUserId: oxy(),
        title: 'x',
        analyticsLastActivity: new Date(),
        sharingShareToken: `tok-${uuidv7()}`,
      }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('conversations_sharing_coherent_check');
  });

  it('accepts a fully shared conversation and a fully private one', async () => {
    const owner = oxy();
    await expect(
      db.insert(conversations).values([
        { oxyUserId: owner, title: 'private', analyticsLastActivity: new Date() },
        {
          oxyUserId: owner,
          title: 'shared',
          analyticsLastActivity: new Date(),
          sharingIsShared: true,
          sharingShareToken: `tok-${uuidv7()}`,
          sharingSharedAt: new Date(),
          sharingExpiresAt: new Date(Date.now() + 86_400_000),
        },
      ]),
    ).resolves.toBeDefined();
    await db.delete(conversations).where(eq(conversations.oxyUserId, owner));
  });
});

describe('place_poi_categories — presence, count and distance agree', () => {
  let poiId: string;

  beforeAll(async () => {
    const [row] = await db
      .insert(placePois)
      .values({
        cellKey: `41.39,2.17@500-${uuidv7()}`,
        lat: 41.39,
        lng: 2.17,
        radiusM: 500,
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning({ id: placePois.id });
    poiId = row.id;
  });

  afterAll(async () => {
    await db.delete(placePois).where(eq(placePois.id, poiId));
  });

  it('refuses `present: false` with a non-zero count', async () => {
    // The widget renders from `present`. Mongo let the two disagree, so a cell
    // with five pharmacies could render as having none.
    const { state, constraint } = await violation(() =>
      db
        .insert(placePoiCategories)
        .values({ placePoiId: poiId, key: 'pharmacy', present: false, count: 5 }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('place_poi_categories_coherent_check');
  });

  it('refuses a nearest distance for a category that is absent', async () => {
    const { state, constraint } = await violation(() =>
      db
        .insert(placePoiCategories)
        .values({ placePoiId: poiId, key: 'school', present: false, count: 0, nearestM: 120 }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('place_poi_categories_coherent_check');
  });

  it('accepts an absent category and a present one', async () => {
    await expect(
      db.insert(placePoiCategories).values([
        { placePoiId: poiId, key: 'bank', present: false, count: 0 },
        { placePoiId: poiId, key: 'park', present: true, count: 2, nearestM: 300 },
      ]),
    ).resolves.toBeDefined();
  });

  it('deletes its categories when the cached cell is swept', async () => {
    // The CASCADE is load-bearing rather than tidy: `place_pois` is under an
    // active expiry sweep, so RESTRICT here would abort the sweep's first batch
    // and the cache would grow forever — the exact failure the registry exists
    // to prevent.
    const [cell] = await db
      .insert(placePois)
      .values({
        cellKey: `sweep-${uuidv7()}`,
        lat: 0,
        lng: 0,
        radiusM: 500,
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() - 1_000),
      })
      .returning({ id: placePois.id });
    await db
      .insert(placePoiCategories)
      .values({ placePoiId: cell.id, key: 'gym', present: true, count: 1, nearestM: 50 });

    await db.delete(placePois).where(eq(placePois.id, cell.id));

    const left = await db
      .select({ id: placePoiCategories.id })
      .from(placePoiCategories)
      .where(eq(placePoiCategories.placePoiId, cell.id));
    expect(left).toEqual([]);
  });
});

describe('the moderation tables', () => {
  it('refuses an enforcement marked applied with no timestamp', async () => {
    // The distinction this table exists to preserve: a plan RECORDED versus a
    // plan EXECUTED. `observe` mode records every action as not applied, which
    // is the whole point of the mode.
    const { state, constraint } = await violation(() =>
      db.insert(moderationEnforcements).values({
        decisionId: uuidv7(),
        decisionRevision: 1,
        action: 'restrict',
        caseId: uuidv7(),
        subjectType: 'property',
        subjectId: propertyId,
        outcome: 'violation',
        reason: 'jury upheld',
        mode: 'automatic',
        applied: true,
      }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('moderation_enforcements_applied_at_check');
  });

  it('refuses an applied timestamp on an action that was only observed', async () => {
    const { state, constraint } = await violation(() =>
      db.insert(moderationEnforcements).values({
        decisionId: uuidv7(),
        decisionRevision: 1,
        action: 'restrict',
        caseId: uuidv7(),
        subjectType: 'property',
        subjectId: propertyId,
        outcome: 'violation',
        reason: 'observed only',
        mode: 'observe',
        appliedAt: new Date(),
      }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('moderation_enforcements_applied_at_check');
  });

  it('lets a correction restore what a removal restricted, on a new revision', async () => {
    // `revision` is IN the idempotency key for exactly this reason. With it,
    // `restore` at revision 2 is a different row from `restrict` at revision 1;
    // without it, an upheld appeal could never put a listing back.
    const decisionId = uuidv7();
    const caseId = uuidv7();
    const shared = {
      decisionId,
      caseId,
      subjectType: 'property',
      subjectId: propertyId,
      outcome: 'violation',
      mode: 'automatic' as const,
      applied: true,
      appliedAt: new Date(),
    };
    await expect(
      db.insert(moderationEnforcements).values([
        { ...shared, decisionRevision: 1, action: 'restrict', reason: 'upheld' },
        { ...shared, decisionRevision: 2, action: 'restore', reason: 'appeal upheld' },
      ]),
    ).resolves.toBeDefined();

    await db
      .delete(moderationEnforcements)
      .where(eq(moderationEnforcements.decisionId, decisionId));
  });

  it('refuses an outbox lease with an owner and no deadline', async () => {
    // A claim that never expires is a row no other dispatcher may ever take —
    // which is how one crashed task stalls the whole queue, silently.
    const { state, constraint } = await violation(() =>
      db.insert(moderationOutbox).values({
        id: `moderation:report.submit:${uuidv7()}`,
        kind: 'report.submit',
        availableAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
        leaseOwner: 'task-1',
      }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('moderation_outbox_lease_pair_check');
  });

  it('accepts an unclaimed row and a fully leased one', async () => {
    const unclaimed = `moderation:report.submit:${uuidv7()}`;
    const leased = `moderation:decision.apply:${uuidv7()}`;
    await expect(
      db.insert(moderationOutbox).values([
        {
          id: unclaimed,
          kind: 'report.submit',
          availableAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
        {
          id: leased,
          kind: 'decision.apply',
          availableAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
          leaseOwner: 'task-1',
          leaseUntil: new Date(Date.now() + 60_000),
        },
      ]),
    ).resolves.toBeDefined();

    await db.delete(moderationOutbox).where(eq(moderationOutbox.id, unclaimed));
    await db.delete(moderationOutbox).where(eq(moderationOutbox.id, leased));
  });

  it('refuses an event queued with no queued-at, and vice versa', async () => {
    const first = await violation(() =>
      db.insert(moderationEvents).values({
        id: uuidv7(),
        state: 'queued',
        receivedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );
    expect(first.constraint).toBe('moderation_events_queued_at_check');

    const second = await violation(() =>
      db.insert(moderationEvents).values({
        id: uuidv7(),
        receivedAt: new Date(),
        queuedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );
    expect(second.constraint).toBe('moderation_events_queued_at_check');
  });

  it('requires a caller-supplied primary key on the two dedupe tables', async () => {
    // The deviation from `generatedId()`, asserted rather than described. If
    // either column ever gained a default, a caller that forgot its deterministic
    // id would silently get a uuid — and the deduplication those tables exist for
    // would stop working with nothing failing.
    const rows = await db.execute<{ table_name: string; column_default: string | null }>(sql`
      select table_name, column_default
      from information_schema.columns
      where table_schema = 'public'
        and column_name = 'id'
        and table_name in ('moderation_outbox', 'moderation_events')
      order by 1
    `);
    expect(rows.map((row) => row.table_name)).toEqual(['moderation_events', 'moderation_outbox']);
    expect(rows.every((row) => row.column_default === null)).toBe(true);
  });
});

describe('the remaining single-table coherence rules', () => {
  it('keeps a roommate pair SORTED, which is what makes the active-pair key canonical', async () => {
    const [low, high] = [oxy(), oxy()].sort();
    const { state, constraint } = await violation(() =>
      db
        .insert(roommateRelationships)
        .values({ oxyUser1Id: high, oxyUser2Id: low, startDate: JAN(1) }),
    );
    expect(state).toBe(CHECK_VIOLATION);
    expect(constraint).toBe('roommate_relationships_sorted_pair_check');

    await expect(
      db
        .insert(roommateRelationships)
        .values({ oxyUser1Id: low, oxyUser2Id: high, startDate: JAN(1) }),
    ).resolves.toBeDefined();
    await db.delete(roommateRelationships).where(eq(roommateRelationships.oxyUser1Id, low));
  });

  it('keeps a commission basis matched to its kind', async () => {
    const [partner] = await db
      .insert(partners)
      .values({ oxyUserId: oxy(), referralCode: `ref-${uuidv7()}` })
      .returning({ id: partners.id });
    const base = {
      partnerId: partner.id,
      propertyId,
      amount: 36,
      basisOffering: 'rent' as const,
      basisDealValue: 1200,
    };

    const flatWithRate = await violation(() =>
      db.insert(commissions).values({ ...base, basisKind: 'flat', basisRate: 0.03, basisFlat: 50 }),
    );
    expect(flatWithRate.constraint).toBe('commissions_basis_components_check');

    const percentWithNoRate = await violation(() =>
      db.insert(commissions).values({ ...base, basisKind: 'percentOfMonthlyRent' }),
    );
    expect(percentWithNoRate.constraint).toBe('commissions_basis_components_check');

    await expect(
      db
        .insert(commissions)
        .values({ ...base, basisKind: 'percentOfMonthlyRent', basisRate: 0.03 }),
    ).resolves.toBeDefined();

    await db.delete(commissions).where(eq(commissions.partnerId, partner.id));
    await db.delete(partners).where(eq(partners.id, partner.id));
  });

  it('requires a UNIT review to name a unit and a BUILDING review not to', async () => {
    // The rule the whole street → building → unit rollup depends on. Mongo
    // declared it as a `validate` on `unitLevelId`, which does not run on an
    // update — and a BUILDING review carrying a `unit_level_id` is counted twice
    // by `getBuildingViewData`.
    const review = {
      addressId: scaffold.addressId,
      streetLevelId: scaffold.addressId,
      buildingLevelId: scaffold.addressId,
      price: 900,
      livedFrom: JAN(1),
      livedTo: new Date(Date.UTC(2026, 6, 1)),
      livedForMonths: 6,
      recommendation: true,
      opinion: 'Piso luminoso y bien comunicado.',
      rating: 4,
      oxyUserId: oxy(),
    };

    const unitWithoutUnit = await violation(() =>
      db.insert(reviews).values({ ...review, addressLevel: 'UNIT' }),
    );
    expect(unitWithoutUnit.constraint).toBe('reviews_unit_level_check');

    const buildingWithUnit = await violation(() =>
      db
        .insert(reviews)
        .values({ ...review, addressLevel: 'BUILDING', unitLevelId: scaffold.addressId }),
    );
    expect(buildingWithUnit.constraint).toBe('reviews_unit_level_check');

    // Both coherent shapes, by TWO authors rather than one.
    // `reviews_author_address_key` (migration 0008) allows one review per person
    // per address, so a single author writing both of these at
    // `scaffold.addressId` is refused by that key before this CHECK is reached —
    // which would make the "accepts both coherent shapes" half assert nothing
    // about `reviews_unit_level_check`.
    const buildingAuthor = oxy();
    const unitAuthor = oxy();
    await expect(
      db.insert(reviews).values([
        { ...review, oxyUserId: buildingAuthor, addressLevel: 'BUILDING' },
        { ...review, oxyUserId: unitAuthor, addressLevel: 'UNIT', unitLevelId: scaffold.addressId },
      ]),
    ).resolves.toBeDefined();
    await db.delete(reviews).where(inArray(reviews.oxyUserId, [buildingAuthor, unitAuthor]));
  });
});
