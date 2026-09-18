/**
 * What a review publishes about the person who wrote it, the tenancy they lived
 * and the rent they paid — ADR 0003 §5.2 (three author-identity forms, chosen by
 * the author), §5.6 (month-grained dates, banded rent) and §4.4 (the aggregate
 * floor), over a REAL Postgres and the REAL routers.
 *
 * ## The leak this pins shut
 *
 * ADR 0003 F2, verbatim: *one unauthenticated review object carries, together,
 * `oxyUserId`, `livedFrom` / `livedTo`, `price`, and `populatedAddress`
 * including `unit`.* #506 removed the unit. This suite is the rest: author,
 * dates and rent, on every read path a stranger can reach.
 *
 * ## Four properties are what let it fail
 *
 *  - **Sentinel values, swept over the WHOLE serialized body.** The exact rent
 *    and the exact tenancy days are distinctive numbers, and the sweep is a
 *    string search over the entire response — so a copy under a key nobody
 *    thought of is still found. The author's Oxy id is swept the same way: it is
 *    the handle that names one person.
 *  - **Every sweep is floored.** Each asserts the review really is in the body,
 *    with its opinion and its rating. A response that 404'd, or that silently
 *    dropped the review, would otherwise pass every "the exact figure is absent"
 *    assertion.
 *  - **Both directions.** The AUTHOR must still be served their own exact rent
 *    and dates, and an `identified` author's id must still be published — a
 *    serializer that withheld everything from everybody would pass the negative
 *    half on its own.
 *  - **All three identity forms, not just the default.** A fixture set with one
 *    form cannot tell a working choice from a serializer that hard-codes it.
 */

import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxy.so/db';

import publicRoutes from '../../routes/public';
import reviewRoutes from '../../routes/reviews';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { findOrCreateAgencyByName } from '../../db/agencies/agencyWrites';
import { getDb } from '../../db/postgres';
import { insertReview } from '../../db/reviews/reviewWrites';
import { addresses, reviews } from '../../db/schema';
import { assertFound } from '../helpers/assertFound';
import { resetGeoTables, seedGeoChain, type GeoChain } from '../helpers/postgresGeoFixtures';

/** Chose `pseudonymous` — the default. */
const PSEUDO_AUTHOR = 'oxy-pub-pseudonymous';
/** The same person, reviewing a second flat in the SAME building. */
const PSEUDO_AUTHOR_SECOND_FLAT = PSEUDO_AUTHOR;
/** Chose `identified`. */
const NAMED_AUTHOR = 'oxy-pub-identified';
/** Chose `verified_anonymous_resident`. */
const ANON_AUTHOR = 'oxy-pub-anonymous';
/** Signed in, wrote nothing. */
const STRANGER = 'oxy-pub-stranger';

const STREET = 'Carrer de la Publicacio';
const OTHER_STREET = 'Carrer de l Altre Edifici';
const NUMBER = '11';
const POSTAL_CODE = '08013';

/**
 * The exact facts that must not reach a third party, chosen so a string sweep
 * cannot match them by accident: a rent nobody rounds to and tenancy days that
 * are not the first of a month.
 */
const EXACT = {
  price: 1337,
  from: new Date('2023-03-17T00:00:00.000Z'),
  to: new Date('2024-08-23T00:00:00.000Z'),
} as const;

/** What §5.6 allows in their place. */
const PUBLISHED = {
  bandMin: 1250,
  bandMax: 1500,
  fromMonth: '2023-03',
  toMonth: '2024-08',
} as const;

function withSession(oxyUserId: string | undefined): RequestHandler {
  return (req, _res, next) => {
    if (oxyUserId) {
      const authed = req as unknown as { user: { id: string }; userId: string };
      authed.user = { id: oxyUserId };
      authed.userId = oxyUserId;
    }
    next();
  };
}

/** The PUBLIC router, exactly as `server.ts` mounts it: optional session, no auth. */
function publicApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use(withSession(oxyUserId));
  app.use('/api', publicRoutes());
  app.use(errorHandler);
  return app;
}

/** The authenticated review router. */
function reviewApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.use(withSession(oxyUserId));
  app.use('/api/reviews', reviewRoutes());
  app.use(errorHandler);
  return app;
}

interface Seeded {
  chain: GeoChain;
  buildingId: string;
  unitAId: string;
  unitBId: string;
  otherBuildingId: string;
  agencySlug: string;
  pseudoReviewId: string;
  namedReviewId: string;
  anonReviewId: string;
  secondFlatReviewId: string;
  otherBuildingReviewId: string;
}

async function seedAddressRow(input: {
  chain: GeoChain;
  street: string;
  floor?: string;
  unit?: string;
  parentAddressId?: string;
}): Promise<string> {
  const [row] = await getDb()
    .insert(addresses)
    .values({
      countryId: input.chain.countryId,
      regionId: input.chain.regionId,
      cityId: input.chain.cityId,
      countryCode: 'ES',
      street: input.street,
      postalCode: POSTAL_CODE,
      number: NUMBER,
      floor: input.floor,
      unit: input.unit,
      longitude: 2.1568,
      latitude: 41.4031,
      parentAddressId: input.parentAddressId,
    })
    .returning({ id: addresses.id });
  return row.id;
}

async function seed(): Promise<Seeded> {
  const chain = await seedGeoChain({ cityName: `Publicacio ${uuidv7().slice(-8)}`, countryCode: 'ES' });
  const db = getDb();

  const buildingId = await seedAddressRow({ chain, street: STREET });
  const unitAId = await seedAddressRow({ chain, street: STREET, floor: '3r', unit: '1a', parentAddressId: buildingId });
  const unitBId = await seedAddressRow({ chain, street: STREET, floor: '4t', unit: '2a', parentAddressId: buildingId });
  const otherBuildingId = await seedAddressRow({ chain, street: OTHER_STREET });

  const agency = await findOrCreateAgencyByName(`Publicacio Agency ${uuidv7().slice(-8)}`);
  assertFound(agency, 'agency');

  const base = {
    streetLevelId: buildingId,
    buildingLevelId: buildingId,
    agencyId: agency.id,
    price: EXACT.price,
    currency: 'EUR' as const,
    livedFrom: EXACT.from,
    livedTo: EXACT.to,
    rating: 4,
    recommendation: true,
  };

  const pseudoReview = await insertReview(db, {
    ...base,
    addressId: unitAId,
    addressLevel: 'UNIT',
    unitLevelId: unitAId,
    oxyUserId: PSEUDO_AUTHOR,
    authorIdentity: 'pseudonymous',
    opinion: 'A pseudonymous account of a winter in this flat.',
  });

  // The SAME person, a second flat in the SAME building — the fixture that makes
  // "stable per author per building" testable at all.
  const secondFlatReview = await insertReview(db, {
    ...base,
    addressId: unitBId,
    addressLevel: 'UNIT',
    unitLevelId: unitBId,
    oxyUserId: PSEUDO_AUTHOR_SECOND_FLAT,
    authorIdentity: 'pseudonymous',
    opinion: 'The same person, one floor up, two years later.',
  });

  // The SAME person at a DIFFERENT building — the other half of the rule.
  const otherBuildingReview = await insertReview(db, {
    ...base,
    streetLevelId: otherBuildingId,
    buildingLevelId: otherBuildingId,
    addressId: otherBuildingId,
    addressLevel: 'BUILDING',
    unitLevelId: null,
    oxyUserId: PSEUDO_AUTHOR,
    authorIdentity: 'pseudonymous',
    opinion: 'The same person, somewhere else entirely.',
  });

  const namedReview = await insertReview(db, {
    ...base,
    addressId: buildingId,
    addressLevel: 'BUILDING',
    unitLevelId: null,
    oxyUserId: NAMED_AUTHOR,
    authorIdentity: 'identified',
    opinion: 'Signed with my own name, because I want the landlord to know.',
  });

  const anonReview = await insertReview(db, {
    ...base,
    addressId: otherBuildingId,
    streetLevelId: otherBuildingId,
    buildingLevelId: otherBuildingId,
    addressLevel: 'BUILDING',
    unitLevelId: null,
    oxyUserId: ANON_AUTHOR,
    authorIdentity: 'verified_anonymous_resident',
    opinion: 'Nothing about me, please.',
  });

  return {
    chain,
    buildingId,
    unitAId,
    unitBId,
    otherBuildingId,
    agencySlug: agency.slug,
    pseudoReviewId: pseudoReview.id,
    namedReviewId: namedReview.id,
    anonReviewId: anonReview.id,
    secondFlatReviewId: secondFlatReview.id,
    otherBuildingReviewId: otherBuildingReview.id,
  };
}

/** Every review object anywhere in a body, found by its opinion text. */
function reviewBodiesIn(body: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (typeof record.opinion === 'string' && typeof record.rating === 'number') found.push(record);
    Object.values(record).forEach(walk);
  };
  walk(body);
  return found;
}

/**
 * The reduced half: the review IS in the body (the vacuity floor), and none of
 * the three exact facts is — anywhere in it, under any key.
 */
function expectPublishedReduced(body: unknown, where: string): void {
  const bodies = reviewBodiesIn(body);
  if (bodies.length === 0) throw new Error(`${where}: no review is in the response at all`);

  for (const review of bodies) {
    // The floor: what a public reader IS entitled to is present.
    expect({ where, rating: review.rating, hasOpinion: typeof review.opinion === 'string' }).toEqual({
      where,
      rating: 4,
      hasOpinion: true,
    });
    for (const key of ['price', 'livedFrom', 'livedTo']) {
      expect({ where, key, present: key in review }).toEqual({ where, key, present: false });
    }
    expect({ where, from: review.livedFromMonth, to: review.livedToMonth }).toEqual({
      where,
      from: PUBLISHED.fromMonth,
      to: PUBLISHED.toMonth,
    });
    expect({ where, band: review.priceBand }).toEqual({
      where,
      band: { min: PUBLISHED.bandMin, max: PUBLISHED.bandMax, currency: 'EUR' },
    });
  }

  // The whole body, not the keys named above. `1337` is the exact rent and
  // `-17` / `-23` are the exact tenancy DAYS: an ISO instant that survived under
  // some other key would carry them.
  const serialized = JSON.stringify(body);
  for (const leak of [String(EXACT.price), EXACT.from.toISOString(), EXACT.to.toISOString()]) {
    expect({ where, leaked: serialized.includes(leak) ? leak : null }).toEqual({ where, leaked: null });
  }
  // Nobody's Oxy account id travels unless they chose `identified`.
  for (const id of [PSEUDO_AUTHOR, ANON_AUTHOR]) {
    expect({ where, id, inBody: serialized.includes(id) }).toEqual({ where, id, inBody: false });
  }
}

let seeded: Seeded;

beforeEach(async () => {
  await resetGeoTables();
  seeded = await seed();
});

describe('the public read paths publish a reduced review', () => {
  it('reduces the author, the dates and the rent on GET /api/reviews/address/:id', async () => {
    for (const viewer of [undefined, STRANGER]) {
      const res = await request(publicApp(viewer))
        .get(`/api/reviews/address/${seeded.buildingId}`)
        .expect(200);
      expectPublishedReduced(res.body, `address reviews, ${viewer ?? 'anonymous'}`);
    }
  });

  it('reduces them on the agency profile’s reviews', async () => {
    const res = await request(publicApp(STRANGER))
      .get(`/api/agencies/${seeded.agencySlug}/reviews`)
      .expect(200);
    expectPublishedReduced(res.body, 'agency reviews');
  });

  it('reduces them on a review detail read and on another author’s feed', async () => {
    const detail = await request(reviewApp(STRANGER))
      .get(`/api/reviews/${seeded.pseudoReviewId}`)
      .expect(200);
    expectPublishedReduced(detail.body, 'review detail, stranger');

    const feed = await request(reviewApp(STRANGER))
      .get(`/api/reviews/user/${PSEUDO_AUTHOR}`)
      .expect(200);
    expectPublishedReduced(feed.body, 'author feed, stranger');
  });
});

describe('the author reads their own review exactly as they wrote it', () => {
  it('serves the exact rent and the exact tenancy dates back', async () => {
    const res = await request(reviewApp(PSEUDO_AUTHOR))
      .get(`/api/reviews/${seeded.pseudoReviewId}`)
      .expect(200);
    const review = res.body.review;

    expect(review.price).toBe(EXACT.price);
    expect(new Date(review.livedFrom).toISOString()).toBe(EXACT.from.toISOString());
    expect(new Date(review.livedTo).toISOString()).toBe(EXACT.to.toISOString());
    // Their own id comes back whatever form they chose — they have to be able to
    // recognise their own review.
    expect(review.oxyUserId).toBe(PSEUDO_AUTHOR);
    // …and so do the reduced shapes, so one renderer draws both audiences.
    expect(review.livedFromMonth).toBe(PUBLISHED.fromMonth);
    expect(review.priceBand).toEqual({ min: PUBLISHED.bandMin, max: PUBLISHED.bandMax, currency: 'EUR' });
  });
});

describe('the three author-identity forms (ADR 0003 §5.2)', () => {
  const publicReviewById = async (addressId: string, reviewId: string) => {
    const res = await request(publicApp(STRANGER)).get(`/api/reviews/address/${addressId}`).expect(200);
    const found = reviewBodiesIn(res.body).find((review) => review.id === reviewId);
    if (!found) throw new Error(`review ${reviewId} is not in the response`);
    return found;
  };

  it('publishes the Oxy account for `identified`, and only for it', async () => {
    const named = await publicReviewById(seeded.buildingId, seeded.namedReviewId);
    expect(named.authorIdentity).toBe('identified');
    expect(named.oxyUserId).toBe(NAMED_AUTHOR);
    // An identified author is named, not keyed: the pseudonym is what stands in
    // for a name, and publishing both would be two handles for one person.
    expect(named).not.toHaveProperty('authorKey');
  });

  it('publishes a per-building key for `pseudonymous`, and no account', async () => {
    const pseudo = await publicReviewById(seeded.buildingId, seeded.pseudoReviewId);
    expect(pseudo.authorIdentity).toBe('pseudonymous');
    expect(pseudo).not.toHaveProperty('oxyUserId');
    expect(typeof pseudo.authorKey).toBe('string');
    expect((pseudo.authorKey as string).length).toBeGreaterThan(0);
  });

  it('publishes NEITHER for `verified_anonymous_resident`', async () => {
    const anon = await publicReviewById(seeded.otherBuildingId, seeded.anonReviewId);
    expect(anon.authorIdentity).toBe('verified_anonymous_resident');
    expect(anon).not.toHaveProperty('oxyUserId');
    // The whole point of the form: two anonymous reviews of one building carry
    // nothing that could tell them apart.
    expect(anon).not.toHaveProperty('authorKey');
  });

  it('keeps one pseudonym per author per BUILDING, and a different one elsewhere', async () => {
    const first = await publicReviewById(seeded.buildingId, seeded.pseudoReviewId);
    const second = await publicReviewById(seeded.buildingId, seeded.secondFlatReviewId);
    // A reader can tell that one person wrote both of these about this building.
    expect(first.authorKey).toBe(second.authorKey);

    const elsewhere = await publicReviewById(seeded.otherBuildingId, seeded.otherBuildingReviewId);
    // …and cannot follow that person to another address, which is what a
    // globally stable pseudonym would allow.
    expect(elsewhere.authorKey).not.toBe(first.authorKey);
    expect(typeof elsewhere.authorKey).toBe('string');
  });

  it('never publishes the stored pseudonym of an author who chose a different form', async () => {
    // The column is `NOT NULL` for every row whatever the form, so that an
    // author switching to `pseudonymous` gets the handle they would have had.
    // That makes "the value exists" true for the identified and anonymous
    // reviews too — and it must still not travel.
    const stored = await getDb()
      .select({ pseudonym: reviews.authorPseudonym })
      .from(reviews)
      .where(eq(reviews.id, seeded.anonReviewId));
    expect(stored[0].pseudonym.length).toBeGreaterThan(0);

    const res = await request(publicApp(STRANGER))
      .get(`/api/reviews/address/${seeded.otherBuildingId}`)
      .expect(200);
    expect(JSON.stringify(res.body)).not.toContain(stored[0].pseudonym);
  });
});

describe('the agency aggregate carries its own author count (ADR 0003 §4.4)', () => {
  it('counts DISTINCT authors, not reviews', async () => {
    const res = await request(publicApp(STRANGER))
      .get(`/api/agencies/${seeded.agencySlug}`)
      .expect(200);

    // Five reviews by four people — the pseudonymous author wrote three of them.
    // Counting published handles instead would see the two per-building
    // pseudonyms as two different people and answer 5, which is the direction
    // that publishes a share it should have withheld.
    expect(res.body.stats.totalReviews).toBe(5);
    expect(res.body.stats.distinctAuthors).toBe(3);
  });
});
