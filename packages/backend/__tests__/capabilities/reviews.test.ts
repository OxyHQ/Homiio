/**
 * The review tools, through the wrapped handlers both MCP lanes call.
 *
 * Asserted: a review is written through the creation allow-list as the
 * EFFECTIVE account (an injected author is ignored), ownership lives in the
 * write statement (a non-author gets not-found), a removed review is hidden
 * from everyone but its author, owners at the address are notified through
 * `notificationDispatchService` and only there, a report is a community report,
 * and a retried `writeReview` with the same idempotency key replays its receipt
 * instead of writing twice.
 */

import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxy.so/db';

import { getDb } from '../../db/postgres';
import { reviewReports, reviews } from '../../db/schema';
import { notificationDispatchService } from '../../services/notificationDispatchService';
import { callTool } from '../helpers/capabilityHarness';
import { seedProperty } from '../helpers/postgresGeoFixtures';

const SUITE = uuidv7().slice(-8);
const AUTHOR = `oxy-rev-author-${SUITE}`;
const OTHER = `oxy-rev-other-${SUITE}`;
const LANDLORD = `oxy-rev-landlord-${SUITE}`;

let counter = 0;
function address(street = `Carrer Review ${SUITE} ${counter++}`) {
  return {
    street,
    number: '10',
    city: `Barcelona ${SUITE}`,
    state: 'Catalonia',
    country: 'Spain',
    countryCode: 'ES',
    postal_code: '08013',
    latitude: '41.39',
    longitude: '2.17',
  };
}

const REVIEW = {
  title: 'A perfectly reasonable title',
  opinion: 'Lived here a while — a reasonable opinion string.',
  rating: 4,
  recommendation: true,
  price: 1000,
  currency: 'EUR',
  livedFrom: '2020-01-01',
  livedTo: '2021-01-01',
};

async function write(oxyUserId = AUTHOR, street?: string) {
  const result = await callTool('writeReview', oxyUserId, {
    address: address(street),
    review: REVIEW,
  });
  if (result.isError) throw new Error(JSON.stringify(result.error));
  return result.structuredContent.review as { id: string };
}

afterEach(() => jest.restoreAllMocks());

describe('writeReview', () => {
  it('writes as the effective account and ignores an injected author', async () => {
    const result = await callTool('writeReview', AUTHOR, {
      address: address(),
      review: { ...REVIEW, oxyUserId: 'oxy-impostor', moderationStatus: 'removed' },
    });
    expect(result.isError).toBe(false);
    const id = (result.structuredContent.review as { id: string }).id;
    const [row] = await getDb().select().from(reviews).where(eq(reviews.id, id));
    expect(row.oxyUserId).toBe(AUTHOR);
    expect(row.moderationStatus).not.toBe('removed');
  });

  it('refuses a title that is too short, as the route does', async () => {
    const result = await callTool('writeReview', AUTHOR, {
      address: address(),
      review: { ...REVIEW, title: 'Hm' },
    });
    expect(result.error).toMatchObject({ status: 400 });
  });

  it('notifies listing owners at the address through the dispatch chokepoint', async () => {
    const street = `Carrer Notificat ${SUITE}`;
    // First write resolves the canonical place; the landlord's listing sits on it.
    const first = await write(OTHER, street);
    const [row] = await getDb().select().from(reviews).where(eq(reviews.id, first.id));
    await seedProperty({
      addressId: row.addressId,
      overrides: { oxyUserId: LANDLORD, status: 'published' },
    });

    const dispatch = jest.spyOn(notificationDispatchService, 'createForUser');
    await write(AUTHOR, street);
    expect(dispatch).toHaveBeenCalledWith(
      LANDLORD,
      expect.objectContaining({ type: 'address_review_created' }),
    );
  });

  it('replays the stored receipt for the same idempotency key, writing once', async () => {
    const input = { address: address(), review: REVIEW };
    const key = `review-${uuidv7()}`;
    const first = await callTool('writeReview', AUTHOR, input, { idempotencyKey: key });
    const second = await callTool('writeReview', AUTHOR, input, { idempotencyKey: key });
    expect(first.isError).toBe(false);
    expect(second.structuredContent).toEqual(first.structuredContent);

    const reused = await callTool(
      'writeReview',
      AUTHOR,
      { address: address(), review: REVIEW },
      { idempotencyKey: key },
    );
    expect(reused.error).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });
});

describe('getReview / listUserReviews / listReviews', () => {
  it('reads a review, and hides a removed one from everyone but its author', async () => {
    const review = await write();
    expect((await callTool('getReview', OTHER, { reviewId: review.id })).isError).toBe(false);

    await getDb()
      .update(reviews)
      .set({ moderationStatus: 'removed' })
      .where(eq(reviews.id, review.id));
    expect((await callTool('getReview', OTHER, { reviewId: review.id })).error).toMatchObject({
      status: 404,
    });
    expect((await callTool('getReview', AUTHOR, { reviewId: review.id })).isError).toBe(false);

    const own = await callTool('listUserReviews', AUTHOR, { oxyUserId: AUTHOR });
    const theirs = await callTool('listUserReviews', OTHER, { oxyUserId: AUTHOR });
    const ids = (result: typeof own) =>
      (result.structuredContent.reviews as Array<{ id: string }>).map((entry) => entry.id);
    expect(ids(own)).toContain(review.id);
    expect(ids(theirs)).not.toContain(review.id);
  });

  it('lists the reviews of the address and its stats', async () => {
    const review = await write();
    const [row] = await getDb().select().from(reviews).where(eq(reviews.id, review.id));
    const listed = await callTool('listReviews', OTHER, { addressId: row.addressId });
    expect(listed.isError).toBe(false);
    expect(listed.structuredContent.level).toBeDefined();
    const stats = await callTool('getAddressReviewStats', OTHER, { addressId: row.addressId });
    expect(stats.structuredContent.stats).toBeDefined();
  });
});

describe('updateReview / deleteReview', () => {
  it('lets the author edit and delete; anyone else gets not-found', async () => {
    const review = await write();
    const foreignEdit = await callTool('updateReview', OTHER, {
      reviewId: review.id,
      changes: { title: 'Hijacked title here' },
    });
    expect(foreignEdit.error).toMatchObject({ status: 404 });

    const edit = await callTool('updateReview', AUTHOR, {
      reviewId: review.id,
      changes: { title: 'An updated, longer title' },
    });
    expect(edit.isError).toBe(false);

    const foreignDelete = await callTool('deleteReview', OTHER, { reviewId: review.id });
    expect(foreignDelete.error).toMatchObject({ status: 404 });
    expect((await callTool('deleteReview', AUTHOR, { reviewId: review.id })).isError).toBe(false);
    expect(await getDb().select().from(reviews).where(eq(reviews.id, review.id))).toHaveLength(0);
  });
});

describe('markReviewHelpful / reportReview', () => {
  it('toggles a helpful vote, notifying the author only on a new vote', async () => {
    const review = await write();
    const dispatch = jest.spyOn(notificationDispatchService, 'createForUser');
    const voted = await callTool('markReviewHelpful', OTHER, { reviewId: review.id });
    expect(voted.structuredContent).toMatchObject({ viewerHasVotedHelpful: true });
    const unvoted = await callTool('markReviewHelpful', OTHER, { reviewId: review.id });
    expect(unvoted.structuredContent).toMatchObject({ viewerHasVotedHelpful: false });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      AUTHOR,
      expect.objectContaining({ type: 'review_helpful' }),
    );

    const own = await callTool('markReviewHelpful', AUTHOR, { reviewId: review.id });
    expect(own.error).toMatchObject({ status: 400 });
  });

  it('files one community report; a second one is a no-op', async () => {
    const review = await write();
    const first = await callTool('reportReview', OTHER, { reviewId: review.id, reason: 'spam' });
    expect(first.structuredContent).toMatchObject({ message: 'Report submitted' });
    const again = await callTool('reportReview', OTHER, { reviewId: review.id, reason: 'spam' });
    expect(again.structuredContent).toMatchObject({ message: 'Report already submitted' });
    const rows = await getDb()
      .select()
      .from(reviewReports)
      .where(eq(reviewReports.reviewId, review.id));
    expect(rows).toHaveLength(1);
  });
});
