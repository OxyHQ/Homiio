/**
 * The review WRITES, against a REAL Postgres server.
 *
 * Every property asserted here is one a mocked drizzle call cannot express, and
 * that is the entire reason this file exists rather than more unit tests. A
 * mocked `insert` accepts any statement, including one the server rejects: the
 * unique key, the two CHECKs, `ON DELETE CASCADE`, and — the one this file was
 * written for — the fact that a failed statement ABORTS a Postgres transaction
 * have no mocked counterpart.
 *
 * `reviews` is EMPTY in production, so nothing here is protecting existing rows.
 * It is protecting the guarantees the first real review will depend on.
 */

import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxyhq/db';

import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { findOrCreateAgencyByName } from '../../db/agencies/agencyWrites';
import {
  deleteOwnReview,
  deriveLivedForMonths,
  DuplicateReviewError,
  insertReview,
  toggleHelpfulVote,
  updateOwnReview,
} from '../../db/reviews/reviewWrites';
import { findReviewById, findReviews, byAuthor } from '../../db/reviews/reviewReads';
import { livedDurationText, serializeReview } from '../../db/reviews/reviewSerializer';
import { agencies, reviewHelpfulVotes, reviewReports, reviews } from '../../db/schema';
import { seedAddress, seedGeoChain } from '../helpers/postgresGeoFixtures';

let db: Database;
let addressId: string;
let otherAddressId: string;

/** A distinct suffix per test, so reruns and parallel workers never collide. */
function unique(prefix: string): string {
  return `${prefix}-${uuidv7()}`;
}

const LIVED_FROM = new Date('2020-01-01T00:00:00.000Z');
const LIVED_TO = new Date('2021-01-01T00:00:00.000Z');

function reviewValues(overrides: {
  addressId: string;
  oxyUserId: string;
  livedFrom?: Date;
  livedTo?: Date;
  rating?: number;
  recommendation?: boolean;
  addressLevel?: 'BUILDING' | 'UNIT';
  unitLevelId?: string | null;
}) {
  return {
    addressId: overrides.addressId,
    addressLevel: overrides.addressLevel ?? ('BUILDING' as const),
    streetLevelId: overrides.addressId,
    buildingLevelId: overrides.addressId,
    unitLevelId: overrides.unitLevelId ?? null,
    oxyUserId: overrides.oxyUserId,
    title: 'A perfectly reasonable title',
    price: 1000,
    currency: 'EUR' as const,
    livedFrom: overrides.livedFrom ?? LIVED_FROM,
    livedTo: overrides.livedTo ?? LIVED_TO,
    rating: overrides.rating ?? 4,
    recommendation: overrides.recommendation ?? true,
    opinion: 'Lived here a while — a reasonable opinion string.',
  };
}

beforeAll(async () => {
  db = await connectPostgres();
  const chain = await seedGeoChain({ countryCode: 'RW', cityName: `Reviewville ${uuidv7()}` });
  addressId = await seedAddress({ chain, street: `Carrer Write ${uuidv7()}`, number: '10' });
  otherAddressId = await seedAddress({ chain, street: `Carrer Write ${uuidv7()}`, number: '12' });
});

afterAll(async () => {
  await closePostgres();
});

describe('livedForMonths is derived at the write chokepoint', () => {
  /**
   * The port of the ONE `pre('validate')` hook on `ReviewSchema`.
   *
   * `lived_for_months` is `NOT NULL` and absent from `CREATABLE_REVIEW_FIELDS`,
   * so nothing but this derivation can supply it. Removing the call from
   * `insertReview` fails this test with a `23502` naming `lived_for_months`;
   * breaking the FORMULA fails it on the value.
   */
  it('computes whole months, rounded up, on create', async () => {
    const created = await insertReview(
      db,
      reviewValues({ addressId, oxyUserId: unique('oxy-months') }),
    );
    // 366 days / 30.44 = 12.02 → 13. The average-month divisor is the source's,
    // not a calendar computation, and this is the value it produces.
    expect(created.livedForMonths).toBe(13);

    const short = await insertReview(
      db,
      reviewValues({
        addressId: otherAddressId,
        oxyUserId: unique('oxy-months-short'),
        livedFrom: new Date('2020-01-01T00:00:00.000Z'),
        livedTo: new Date('2020-02-15T00:00:00.000Z'),
      }),
    );
    // 45 days / 30.44 = 1.48 → 2.
    expect(short.livedForMonths).toBe(2);
  });

  /**
   * The hook ran on every `save()`, so an EDIT that moved the dates moved the
   * duration with them.
   *
   * The fixture moves only `livedTo`, which is the shape that discriminates:
   * with both dates in the patch a recompute and a naive "write what the client
   * sent" produce the same answer, and with neither there is nothing to see.
   */
  it('recomputes on an edit that moves ONE side of the tenancy', async () => {
    const oxyUserId = unique('oxy-edit-months');
    const created = await insertReview(db, reviewValues({ addressId, oxyUserId }));
    expect(created.livedForMonths).toBe(13);

    const updated = await updateOwnReview({
      reviewId: created.id,
      oxyUserId,
      patch: { livedTo: new Date('2020-04-01T00:00:00.000Z') },
    });
    // 91 days / 30.44 = 2.99 → 3.
    expect(updated?.livedForMonths).toBe(3);
  });

  it('refuses an inverted tenancy at the database, not at the derivation', async () => {
    const failure = await insertReview(
      db,
      reviewValues({
        addressId,
        oxyUserId: unique('oxy-inverted'),
        livedFrom: LIVED_TO,
        livedTo: LIVED_FROM,
      }),
    )
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(failure).toBeDefined();
    expect(String(failure)).toContain('Failed query');
  });

  it('exposes the divisor through one function both write paths call', () => {
    expect(deriveLivedForMonths(LIVED_FROM, LIVED_TO)).toBe(13);
    expect(deriveLivedForMonths(LIVED_TO, LIVED_FROM)).toBe(13);
  });
});

describe('one review per person per address', () => {
  /**
   * `reviews_author_address_key`, and the transaction it must not poison.
   *
   * This is the regression `db/postgres.ts`'s `inSavepoint` docblock describes,
   * reached from the review side: `createReview` runs `insertReview` inside a
   * transaction that has already resolved an agency, so a bare `23505` would
   * abort the whole thing and every statement the caller issues afterwards would
   * die with `25P02` instead of producing the friendly 400.
   *
   * The assertion that the handle is STILL USABLE is what pins the savepoint —
   * remove `inSavepoint` from `insertReview` and the `select` below throws
   * `current_transaction_is_aborted` rather than returning a row.
   */
  it('refuses a duplicate INSIDE a transaction and leaves the transaction usable', async () => {
    const oxyUserId = unique('oxy-dupe');
    const first = await insertReview(db, reviewValues({ addressId, oxyUserId }));

    const outcome = await db.transaction(async (tx) => {
      const refusal = await insertReview(tx, reviewValues({ addressId, oxyUserId }))
        .then(() => undefined)
        .catch((error: unknown) => error);

      // The caller's own transaction is still alive: this read is the one that
      // dies with 25P02 if the failed insert was not wrapped in a savepoint.
      const [stillThere] = await tx
        .select({ id: reviews.id })
        .from(reviews)
        .where(eq(reviews.id, first.id));

      return { refusal, stillThere };
    });

    expect(outcome.refusal).toBeInstanceOf(DuplicateReviewError);
    expect(outcome.stillThere.id).toBe(first.id);
  });

  it('lets the same person review a DIFFERENT address', async () => {
    const oxyUserId = unique('oxy-two-addresses');
    await insertReview(db, reviewValues({ addressId, oxyUserId }));
    const second = await insertReview(db, reviewValues({ addressId: otherAddressId, oxyUserId }));
    expect(second.id).toBeDefined();
  });

  it('lets a DIFFERENT person review the same address', async () => {
    const first = await insertReview(
      db,
      reviewValues({ addressId, oxyUserId: unique('oxy-neighbour-a') }),
    );
    const second = await insertReview(
      db,
      reviewValues({ addressId, oxyUserId: unique('oxy-neighbour-b') }),
    );
    expect(second.id).not.toBe(first.id);
  });

  /**
   * The key is NOT partial on `moderation_status <> 'removed'`, unlike the seven
   * scoped indexes beside it.
   *
   * A removal still occupies its author's one slot at that address — otherwise a
   * jury's decision is undone by pressing submit again.
   */
  it('keeps the slot occupied by a REMOVED review', async () => {
    const oxyUserId = unique('oxy-removed-slot');
    const created = await insertReview(db, reviewValues({ addressId, oxyUserId }));
    await db.update(reviews).set({ moderationStatus: 'removed' }).where(eq(reviews.id, created.id));

    await expect(insertReview(db, reviewValues({ addressId, oxyUserId }))).rejects.toBeInstanceOf(
      DuplicateReviewError,
    );
  });
});

describe('`findOrCreateAgencyByName` survives a slug collision inside a transaction', () => {
  /**
   * The defect this port surfaced, and it was NOT introduced here.
   *
   * `findOrCreateAgencyByName` has taken a transaction handle since it was
   * written — its parameter comment says the handle is there "so the review
   * create path can use it" — and its slug-collision branch is an insert, a
   * caught `23505`, and a RETRY on the same handle. On the root connection that
   * works; inside a transaction the first failure aborts everything, so the
   * retry dies with `25P02` and `POST /api/reviews` 500s.
   *
   * The review create path is the first caller to pass a transaction, so this is
   * the first test that could see it. Removing `inSavepoint` from
   * `agencyWrites.ts` turns this red with `current_transaction_is_aborted`.
   *
   * The FIXTURE is the discriminating part: two agencies whose names slugify
   * identically but normalize DIFFERENTLY. Two names that normalize the same
   * would take the `agencies_normalized_name_key` branch and be reused, and the
   * retry — the thing under test — would never run.
   */
  it('advances the slug suffix without poisoning the caller', async () => {
    const stem = `Colliding ${uuidv7().slice(0, 8)}`;
    const first = await findOrCreateAgencyByName(stem);
    expect(first).not.toBeNull();

    // `!` on the name would slugify the same (`-` collapses runs) while
    // normalizing to a different key, so the second insert hits the SLUG index.
    const second = await db.transaction((tx) => findOrCreateAgencyByName(`${stem}!`, tx));

    expect(second).not.toBeNull();
    expect(second?.id).not.toBe(first?.id);
    expect(second?.slug).not.toBe(first?.slug);

    const rows = await db.select().from(agencies).where(eq(agencies.slug, second?.slug ?? ''));
    expect(rows).toHaveLength(1);
  });
});

describe('ownership lives in the statement', () => {
  it('refuses an edit by a non-owner without revealing the review exists', async () => {
    const created = await insertReview(
      db,
      reviewValues({ addressId, oxyUserId: unique('oxy-owner') }),
    );

    const stranger = await updateOwnReview({
      reviewId: created.id,
      oxyUserId: unique('oxy-stranger'),
      patch: { title: 'Stranger edit' },
    });
    expect(stranger).toBeNull();

    const [untouched] = await db
      .select({ title: reviews.title })
      .from(reviews)
      .where(eq(reviews.id, created.id));
    expect(untouched.title).toBe('A perfectly reasonable title');
  });

  it('refuses a delete by a non-owner and deletes for the owner', async () => {
    const oxyUserId = unique('oxy-deleter');
    const created = await insertReview(db, reviewValues({ addressId, oxyUserId }));

    expect(await deleteOwnReview({ reviewId: created.id, oxyUserId: unique('oxy-other') })).toBe(false);
    expect(await deleteOwnReview({ reviewId: created.id, oxyUserId })).toBe(true);
    expect(await deleteOwnReview({ reviewId: created.id, oxyUserId })).toBe(false);
  });

  /**
   * Both child tables CASCADE, which is what makes the delete ONE statement.
   *
   * Without the cascade, `review_helpful_votes.review_id` is a `NOT NULL`
   * foreign key and the delete would raise `23503` — a 500 on a button the
   * author is entitled to press.
   */
  it('takes the helpful votes and the reports with it', async () => {
    const oxyUserId = unique('oxy-cascade');
    const created = await insertReview(db, reviewValues({ addressId, oxyUserId }));
    await toggleHelpfulVote({ reviewId: created.id, oxyUserId: unique('oxy-voter') });
    await db
      .insert(reviewReports)
      .values({ reviewId: created.id, oxyUserId: unique('oxy-reporter'), reason: 'spam' });

    expect(await deleteOwnReview({ reviewId: created.id, oxyUserId })).toBe(true);
    expect(
      await db.select().from(reviewHelpfulVotes).where(eq(reviewHelpfulVotes.reviewId, created.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(reviewReports).where(eq(reviewReports.reviewId, created.id)),
    ).toHaveLength(0);
  });
});

describe('the helpful-vote toggle', () => {
  it('flips on, then off, and reports the count each way', async () => {
    const created = await insertReview(
      db,
      reviewValues({ addressId, oxyUserId: unique('oxy-vote-author') }),
    );
    const voter = unique('oxy-voter');

    const on = await toggleHelpfulVote({ reviewId: created.id, oxyUserId: voter });
    expect(on).toEqual({ helpfulCount: 1, viewerHasVotedHelpful: true });

    const off = await toggleHelpfulVote({ reviewId: created.id, oxyUserId: voter });
    expect(off).toEqual({ helpfulCount: 0, viewerHasVotedHelpful: false });
  });

  /**
   * Two concurrent toggles from ONE person leave exactly one row.
   *
   * `$addToSet` gave set semantics inside a document and the controller's
   * `alreadyVoted` read put the race back: both callers could read "not voted"
   * and both `$addToSet`. Here the DELETE's `RETURNING` set is the decision, so
   * one deletes and the other inserts — and `review_helpful_votes_review_user_key`
   * catches anything the ordering does not.
   */
  it('never stores two votes from one person, under concurrency', async () => {
    const created = await insertReview(
      db,
      reviewValues({ addressId, oxyUserId: unique('oxy-race-author') }),
    );
    const voter = unique('oxy-race-voter');

    await Promise.all([
      toggleHelpfulVote({ reviewId: created.id, oxyUserId: voter }),
      toggleHelpfulVote({ reviewId: created.id, oxyUserId: voter }),
    ]);

    const rows = await db
      .select()
      .from(reviewHelpfulVotes)
      .where(eq(reviewHelpfulVotes.reviewId, created.id));
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  /**
   * The count is CORRELATED to its own review.
   *
   * The fixture is the whole point: one voter across TWO reviews plus a second
   * voter on one of them. "Two votes by two people" cannot tell a per-review
   * count from a global one — both read 2 — while 2-and-1 does. This is the
   * `count_distinct` shape `db/MIGRATION-CONTRACT.md` names, and dropping the
   * `qualified()` on the correlated reference makes every review report the same
   * number with no error at all.
   */
  it('counts votes per review, not across reviews', async () => {
    const author = unique('oxy-count-author');
    const busy = await insertReview(db, reviewValues({ addressId, oxyUserId: author }));
    const quiet = await insertReview(
      db,
      reviewValues({ addressId: otherAddressId, oxyUserId: author }),
    );

    const roaming = unique('oxy-roaming-voter');
    const local = unique('oxy-local-voter');
    await toggleHelpfulVote({ reviewId: busy.id, oxyUserId: roaming });
    await toggleHelpfulVote({ reviewId: quiet.id, oxyUserId: roaming });
    await toggleHelpfulVote({ reviewId: busy.id, oxyUserId: local });

    const busyRead = await findReviewById(busy.id, roaming);
    const quietRead = await findReviewById(quiet.id, local);

    expect(busyRead?.helpfulCount).toBe(2);
    expect(quietRead?.helpfulCount).toBe(1);
    // And the viewer flag is scoped to the VIEWER as well as the review.
    expect(busyRead?.viewerHasVotedHelpful).toBe(true);
    expect(quietRead?.viewerHasVotedHelpful).toBe(false);
  });

  it('reports no vote at all when nobody is asking', async () => {
    const created = await insertReview(
      db,
      reviewValues({ addressId, oxyUserId: unique('oxy-anon-author') }),
    );
    await toggleHelpfulVote({ reviewId: created.id, oxyUserId: unique('oxy-anon-voter') });

    const anonymous = await findReviewById(created.id, null);
    expect(anonymous?.helpfulCount).toBe(1);
    expect(anonymous?.viewerHasVotedHelpful).toBe(false);
  });
});

describe('the unit-level biconditional', () => {
  /**
   * `reviews_unit_level_check` is `(address_level = 'UNIT') = (unit_level_id is
   * not null)`, and BOTH violating shapes are asserted.
   *
   * A test that only inserted the first would pass against a CHECK written
   * `address_level <> 'UNIT' or unit_level_id is not null`, which admits the
   * second — a BUILDING review carrying a unit id, which `getBuildingViewData`
   * then counts twice.
   */
  it('refuses a UNIT review with no unit', async () => {
    const failure = await insertReview(
      db,
      reviewValues({
        addressId,
        oxyUserId: unique('oxy-unit-missing'),
        addressLevel: 'UNIT',
        unitLevelId: null,
      }),
    )
      .then(() => undefined)
      .catch((error: unknown) => error);
    expect(failure).toBeDefined();
  });

  it('refuses a BUILDING review that names a unit', async () => {
    const failure = await insertReview(
      db,
      reviewValues({
        addressId,
        oxyUserId: unique('oxy-building-with-unit'),
        addressLevel: 'BUILDING',
        unitLevelId: addressId,
      }),
    )
      .then(() => undefined)
      .catch((error: unknown) => error);
    expect(failure).toBeDefined();
  });

  it('accepts both coherent shapes', async () => {
    const building = await insertReview(
      db,
      reviewValues({ addressId, oxyUserId: unique('oxy-coherent-building') }),
    );
    expect(building.unitLevelId).toBeNull();

    const unit = await insertReview(
      db,
      reviewValues({
        addressId: otherAddressId,
        oxyUserId: unique('oxy-coherent-unit'),
        addressLevel: 'UNIT',
        unitLevelId: otherAddressId,
      }),
    );
    expect(unit.unitLevelId).toBe(otherAddressId);
  });
});

describe('the serializer', () => {
  it('renders livedDurationText across the year boundary', () => {
    expect(livedDurationText(1)).toBe('1 month');
    expect(livedDurationText(11)).toBe('11 months');
    expect(livedDurationText(12)).toBe('1 year');
    expect(livedDurationText(24)).toBe('2 years');
    expect(livedDurationText(13)).toBe('1 year 1 month');
    expect(livedDurationText(26)).toBe('2 years 2 months');
  });

  /**
   * The voter list and the report queue are separate TABLES that no read in this
   * domain selects from, so there is no key for a serializer to forget to strip.
   * Asserted anyway, because that is the property the old DTO's two `delete`
   * statements existed to provide.
   */
  it('publishes no voter list and no report queue', async () => {
    const oxyUserId = unique('oxy-serialize');
    const created = await insertReview(db, reviewValues({ addressId, oxyUserId }));
    await toggleHelpfulVote({ reviewId: created.id, oxyUserId: unique('oxy-serialize-voter') });
    await db
      .insert(reviewReports)
      .values({ reviewId: created.id, oxyUserId: unique('oxy-serialize-reporter'), reason: 'spam' });

    const hydrated = await findReviewById(created.id, oxyUserId);
    expect(hydrated).not.toBeNull();
    const dto = hydrated ? serializeReview(hydrated) : {};

    expect(dto.helpfulVoters).toBeUndefined();
    expect(dto.reports).toBeUndefined();
    expect(dto._id).toBeUndefined();
    expect(dto.id).toBe(created.id);
    expect(dto.helpfulCount).toBe(1);
    expect(dto.livedDurationText).toBe('1 year 1 month');
    // The single address wire shape, with its geo names resolved by the join.
    expect(dto.populatedAddress).toMatchObject({ id: addressId });
  });

  it('omits an absent optional column rather than publishing null', async () => {
    const created = await insertReview(
      db,
      reviewValues({ addressId: otherAddressId, oxyUserId: unique('oxy-absent') }),
    );
    const hydrated = await findReviewById(created.id, null);
    const dto = hydrated ? serializeReview(hydrated) : {};

    expect('unitLevelId' in dto).toBe(false);
    expect('agency' in dto).toBe(false);
    expect('depositReturned' in dto).toBe(false);
    // A FALSE is a value, not an absence.
    expect(dto.verified).toBe(false);
  });
});

describe('author-scoped reads', () => {
  it('finds every review by one person', async () => {
    const oxyUserId = unique('oxy-mine');
    await insertReview(db, reviewValues({ addressId, oxyUserId }));
    await insertReview(db, reviewValues({ addressId: otherAddressId, oxyUserId }));

    const mine = await findReviews({ where: byAuthor(oxyUserId), viewer: oxyUserId });
    expect(mine).toHaveLength(2);
  });
});
