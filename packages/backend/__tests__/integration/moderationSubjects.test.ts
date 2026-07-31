/**
 * What a jury is actually shown about a Homiio listing or review.
 *
 * These assertions are about EXPOSURE as much as correctness. A snapshot that
 * carries a street number the advert chose to hide, or a precise coordinate, has
 * reproduced the harm inside the review of it — and nothing downstream would
 * notice, because the delivery would succeed.
 */

import mongoose from 'mongoose';
import {
  ListingReportReason,
  ModerationReportedType,
  PropertyStatus,
  PropertyType,
  OfferingType,
  ReviewReportReason,
} from '@homiio/shared-types';

import { subjectProviderFor, deliverableTypes } from '../../services/moderation/subjects/registry';
import {
  buildModerationReportInput,
  ModerationSubjectUnsupportedError,
  snapshotHash,
} from '../../services/moderation/EvidenceSnapshotService';
import { allegationForReport } from '../../services/moderation/reportTaxonomy';
import { models } from '../helpers/factories';
import { assertFound } from '../helpers/assertFound';
import type {
  ModerationContextResource,
  ModerationResource,
  ModerationSubjectSnapshot,
} from '../../services/moderation/subjects/types';

const { Property, Address, Country, Region, City, Neighborhood, Review } = models;

/**
 * The geo hierarchy, created once per test.
 *
 * Upserted rather than inserted: `Country.code` is unique, and a test that
 * builds two listings would otherwise fail on a duplicate key rather than on
 * anything it was written to check.
 */
async function geoChain(): Promise<{
  countryId: unknown;
  regionId: unknown;
  cityId: unknown;
  neighborhoodId: unknown;
}> {
  const upsert = { upsert: true, new: true, setDefaultsOnInsert: true };
  const country = await Country.findOneAndUpdate(
    { code: 'ES' },
    { $setOnInsert: { code: 'ES', name: 'Spain' } },
    upsert,
  );
  assertFound(country, 'country');
  const region = await Region.findOneAndUpdate(
    { countryId: country._id, name: 'Catalonia' },
    { $setOnInsert: { countryId: country._id, name: 'Catalonia' } },
    upsert,
  );
  assertFound(region, 'region');
  const city = await City.findOneAndUpdate(
    { regionId: region._id, name: 'Barcelona' },
    { $setOnInsert: { countryId: country._id, regionId: region._id, name: 'Barcelona' } },
    upsert,
  );
  assertFound(city, 'city');
  const neighborhood = await Neighborhood.findOneAndUpdate(
    { cityId: city._id, name: 'Gràcia' },
    {
      $setOnInsert: {
        countryId: country._id,
        regionId: region._id,
        cityId: city._id,
        name: 'Gràcia',
      },
    },
    upsert,
  );
  assertFound(neighborhood, 'neighborhood');
  return {
    countryId: country._id,
    regionId: region._id,
    cityId: city._id,
    neighborhoodId: neighborhood._id,
  };
}

/** A precise point, exactly the kind a snapshot must never pass through. */
const PRECISE_LONGITUDE = 2.156_789;
const PRECISE_LATITUDE = 41.403_456;

/**
 * One address, reused.
 *
 * `Address.normalizedKey` is unique — the canonical-address model deliberately
 * refuses two rows for the same door — so a test that builds two listings at the
 * same street must share the address rather than create it twice. `street`
 * varies where a test needs distinct doors.
 */
async function addressAt(street = 'Carrer de Verdi'): Promise<{ _id: unknown }> {
  const geo = await geoChain();
  const existing = await Address.findOne({ street, number: '42' });
  if (existing) return existing;
  return Address.create({
    ...geo,
    countryCode: 'ES',
    street,
    number: '42',
    postal_code: '08012',
    coordinates: { type: 'Point', coordinates: [PRECISE_LONGITUDE, PRECISE_LATITUDE] },
  });
}

async function listing(
  overrides: Record<string, unknown> = {},
  street?: string,
): Promise<{ _id: unknown }> {
  const address = await addressAt(street);
  return Property.create({
    oxyUserId: 'oxy-landlord',
    addressId: address._id,
    type: PropertyType.APARTMENT,
    bedrooms: 2,
    bathrooms: 1,
    description: 'Bright flat, two bedrooms, women only, no DSS.',
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: { monthlyAmount: 1450, currency: 'EUR' },
    status: PropertyStatus.PUBLISHED,
    ...overrides,
  });
}

/**
 * Narrowing that FAILS instead of skipping.
 *
 * Every assertion below used to sit inside `if (resource?.type === 'location')`,
 * which reads as careful type-narrowing and is actually a vacuity hole: a
 * provider that returned no location at all skips the block entirely and the
 * test passes green, reporting that the exposure rules hold when nothing was
 * checked. That is precisely the failure this file exists to catch — the
 * `addressId`/`address` hook made the location resource disappear while delivery
 * still succeeded, and a skipped block would have said nothing was wrong.
 *
 * These throw with the value they actually got, so a missing or wrong-typed
 * resource fails and names itself.
 */
function requireSnapshot(
  snapshot: ModerationSubjectSnapshot | null | undefined,
): ModerationSubjectSnapshot {
  if (!snapshot) throw new Error('expected a snapshot, got none');
  return snapshot;
}

function requireResource<T extends string>(
  resource: { type?: string } | string | null | undefined,
  type: T,
  what: string,
): Extract<ModerationResource | ModerationContextResource, { type: T }> {
  if (typeof resource !== 'object' || resource === null || resource.type !== type) {
    throw new Error(
      `expected ${what} to be a '${type}' resource, got ${JSON.stringify(resource)}`,
    );
  }
  return resource as Extract<ModerationResource | ModerationContextResource, { type: T }>;
}

/**
 * The subject's own location context, or a failure naming what was there.
 *
 * Returns just the `data`. `Extract<…, { type: 'location' }>` over the context
 * union and over the resource union are two structurally identical but distinct
 * `Omit<>` instantiations that TypeScript will not unify, and every assertion
 * here is about the data anyway.
 */
function requireLocation(snapshot: ModerationSubjectSnapshot | null | undefined): {
  label?: string;
  latitude?: number;
  longitude?: number;
} {
  const context = requireSnapshot(snapshot).context;
  if (!context || context.length === 0) {
    throw new Error('expected a location context resource, got none');
  }
  return requireResource(context[0], 'location', 'the first context resource').data;
}

describe('moderation subject registry', () => {
  /**
   * The delivered surface, pinned.
   *
   * The difference between a delivered type and a local-only one is invisible in
   * a 201, so registering a provider — or forgetting to — is a change no
   * response body would reveal. Widening this set should require editing this
   * line and saying why.
   */
  it('delivers exactly the types with a provider', () => {
    expect(deliverableTypes().sort()).toEqual(['property', 'review']);
    expect(subjectProviderFor(ModerationReportedType.EVICTION_CASE)).toBeUndefined();
  });
});

describe('property subject provider', () => {
  it('describes a listing as a commerce listing with its price', async () => {
    const property = await listing();
    const snapshot = await subjectProviderFor(ModerationReportedType.PROPERTY)?.snapshot(
      String(property._id),
    );

    const described = requireSnapshot(snapshot);
    expect(described.subject.type).toBe('commerce.listing');
    expect(described.subject.author).toEqual({ oxyUserId: 'oxy-landlord' });

    const content = requireResource(described.content, 'listing', 'the subject content');
    // The title Homiio itself renders, generated by the app's own helper — it
    // leads with the neighbourhood, so that is what a jury reads.
    expect(content.data.title).toBe('Apartment in Gràcia');
    expect(content.data.description).toContain('Bright flat');
    // Price and currency travel together or not at all — the contract refuses
    // one without the other.
    expect(content.data.price).toBe(1450);
    expect(content.data.currency).toBe('EUR');
  });

  /**
   * The assertion this whole provider exists for.
   *
   * A precise coordinate in a moderation snapshot reproduces the exposure inside
   * the review of it. Two decimal places is roughly a kilometre — enough for a
   * jury to see which neighbourhood, not enough to find a door.
   */
  it('coarsens coordinates rather than passing the stored point through', async () => {
    const property = await listing();
    const snapshot = await subjectProviderFor(ModerationReportedType.PROPERTY)?.snapshot(
      String(property._id),
    );

    const location = requireLocation(snapshot);
    expect(location.longitude).toBe(2.16);
    expect(location.latitude).toBe(41.4);
    expect(location.longitude).not.toBe(PRECISE_LONGITUDE);
    expect(location.latitude).not.toBe(PRECISE_LATITUDE);
  });

  it('publishes the building number only when the advert does', async () => {
    const shown = await listing({ showAddressNumber: true });
    const hidden = await listing({ showAddressNumber: false }, 'Carrer de Torrijos');
    const provider = subjectProviderFor(ModerationReportedType.PROPERTY);

    const shownSnapshot = await provider?.snapshot(String(shown._id));
    const hiddenSnapshot = await provider?.snapshot(String(hidden._id));

    const shownLocation = requireLocation(shownSnapshot);
    const hiddenLocation = requireLocation(hiddenSnapshot);

    expect(shownLocation.label).toContain('Carrer de Verdi 42');
    // The advert hid it, so the snapshot has not exposed one. Anything else
    // would put Homiio's database in front of a jury as if it were the advert.
    expect(hiddenLocation.label).toContain('Carrer de Torrijos');
    expect(hiddenLocation.label).not.toContain('42');
  });

  /**
   * An aggregated listing belongs to a portal, not to anyone with an Oxy
   * identity. Naming a principal Homiio cannot identify would attach a
   * reputation consequence to the wrong person — or to nobody, silently.
   */
  it('gives an external listing no author', async () => {
    const address = await addressAt();
    const external = await Property.create({
      addressId: address._id,
      type: PropertyType.APARTMENT,
      bedrooms: 1,
      bathrooms: 1,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 900, currency: 'EUR' },
      status: PropertyStatus.PUBLISHED,
      isExternal: true,
      source: 'idealista',
      sourceId: 'ext-1',
      sourceUrl: 'https://www.idealista.com/inmueble/1/',
    });

    const snapshot = await subjectProviderFor(ModerationReportedType.PROPERTY)?.snapshot(
      String(external._id),
    );

    // `requireSnapshot` first: `snapshot?.subject.author` on an ABSENT snapshot
    // is also `undefined`, so the author assertion alone would pass for a
    // provider that described nothing at all.
    const described = requireSnapshot(snapshot);
    expect(described.subject.author).toBeUndefined();
    expect(described.metadata?.listingIsExternal).toBe(true);
    expect(described.metadata?.listingSource).toBe('idealista');
  });

  it('returns null for a listing that no longer exists', async () => {
    const provider = subjectProviderFor(ModerationReportedType.PROPERTY);
    expect(await provider?.snapshot(String(new mongoose.Types.ObjectId()))).toBeNull();
    // A malformed id is a fact about the world too, not a crash.
    expect(await provider?.snapshot('not-an-object-id')).toBeNull();
  });
});

describe('review subject provider', () => {
  async function review(overrides: Record<string, unknown> = {}): Promise<{ _id: unknown }> {
    const address = await addressAt();
    return Review.create({
      addressId: address._id,
      addressLevel: 'BUILDING',
      streetLevelId: address._id,
      buildingLevelId: address._id,
      oxyUserId: 'oxy-reviewer',
      title: 'Two difficult years',
      greenHouse: 'n/a',
      price: 1200,
      currency: 'EUR',
      livedFrom: new Date('2023-01-01'),
      livedTo: new Date('2025-01-01'),
      livedForMonths: 24,
      recommendation: false,
      opinion: 'The landlord kept the deposit and stopped answering.',
      prosItems: ['Quiet street'],
      consItems: ['Damp in winter'],
      rating: 2,
      ...overrides,
    });
  }

  it('carries the reviewer’s words and attributes them to the reviewer', async () => {
    const stored = await review();
    const snapshot = await subjectProviderFor(ModerationReportedType.REVIEW)?.snapshot(
      String(stored._id),
    );

    const described = requireSnapshot(snapshot);
    expect(described.subject.type).toBe('commerce.review');
    expect(described.subject.author).toEqual({ oxyUserId: 'oxy-reviewer' });

    const content = requireResource(described.content, 'text', 'the subject content');
    expect(content.data.text).toContain('kept the deposit');
    expect(content.data.text).toContain('Pros: Quiet street');
    expect(content.data.text).toContain('Cons: Damp in winter');
  });

  /**
   * The difference from a listing, and it is deliberate. A listing's address was
   * published by the advertiser; a review's address is where the reviewer lived
   * and where somebody may still live. Nothing about judging whether a review is
   * fabricated needs the street.
   */
  it('never carries the street of the home a review is about', async () => {
    const stored = await review();
    const snapshot = await subjectProviderFor(ModerationReportedType.REVIEW)?.snapshot(
      String(stored._id),
    );

    const location = requireLocation(snapshot);
    expect(location.label).toBe('Gràcia, Barcelona');
    expect(location.label).not.toContain('Verdi');
    expect(location.longitude).toBe(2.16);
  });

  /**
   * Rows written before `prosItems`/`consItems` existed must not arrive at a
   * jury as an empty body.
   */
  it('falls back to the legacy free-text fields', async () => {
    const stored = await review({
      opinion: 'Short opinion.',
      prosItems: [],
      consItems: [],
      positiveComment: 'Landlord fixed the boiler quickly',
      negativeComment: 'Noisy neighbours',
    });
    const snapshot = await subjectProviderFor(ModerationReportedType.REVIEW)?.snapshot(
      String(stored._id),
    );

    const content = requireResource(
      requireSnapshot(snapshot).content,
      'text',
      'the subject content',
    );
    expect(content.data.text).toContain('Pros: Landlord fixed the boiler quickly');
    expect(content.data.text).toContain('Cons: Noisy neighbours');
  });
});

describe('report input', () => {
  it('declares the media it cannot attach', async () => {
    const property = await listing();
    const input = await buildModerationReportInput({
      id: 'report-1',
      reportedType: ModerationReportedType.PROPERTY,
      reportedId: String(property._id),
      reporter: 'oxy-reporter',
      reason: ListingReportReason.INACCURATE,
      details: 'The photos are of a different flat.',
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
    });

    expect(input).not.toBeNull();
    // Honest rather than silent: Homiio photos have no Oxy file id and no stored
    // digest, so a jury is told material exists that it was not given.
    expect(input?.reportInput.metadata?.evidenceAttachmentsSupported).toBe(false);
    expect(input?.reportInput.attachments).toBeUndefined();
  });

  /**
   * Ingest's classifier reading travels as context, never as a claim. Promoting
   * it to an allegation would put a machine's guess in front of a jury as if a
   * person had asserted it.
   */
  it('carries ingest listing flags as metadata and never as an allegation', async () => {
    const property = await listing({
      listingFlags: { genderRestricted: true, noDSS: true, noPets: false },
    });
    const input = await buildModerationReportInput({
      id: 'report-flags',
      reportedType: ModerationReportedType.PROPERTY,
      reportedId: String(property._id),
      reporter: 'oxy-reporter',
      reason: ListingReportReason.INACCURATE,
      createdAt: new Date(),
    });

    expect(input?.reportInput.metadata?.listingFlag_genderRestricted).toBe(true);
    expect(input?.reportInput.metadata?.listingFlag_noDSS).toBe(true);
    // A flag that did not fire is absent, not `false`.
    expect(input?.reportInput.metadata?.listingFlag_noPets).toBeUndefined();

    const codes = input?.reportInput.allegations.map((allegation) =>
      typeof allegation === 'string' ? allegation : allegation.code,
    );
    expect(codes).toEqual(['commerce.misleading_listing']);
    expect(codes).not.toContain('hate.protected_targeting');
  });

  /**
   * Ingress fingerprints the whole envelope, so anything that varies per attempt
   * turns a legitimate outbox retry into a permanent 409 — days later, as a
   * report silently stuck in a queue.
   */
  it('produces the same payload on every attempt', async () => {
    const property = await listing();
    const report = {
      id: 'report-stable',
      reportedType: ModerationReportedType.PROPERTY,
      reportedId: String(property._id),
      reporter: 'oxy-reporter',
      reason: ListingReportReason.SCAM,
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
    };

    const first = await buildModerationReportInput(report);
    const second = await buildModerationReportInput(report);

    expect(JSON.stringify(first?.reportInput)).toBe(JSON.stringify(second?.reportInput));
    // The submitted-at is the REPORT's own timestamp, never the moment of
    // delivery — that is the field most likely to be "helpfully" defaulted.
    expect(first?.reportInput.submittedAt).toEqual(report.createdAt);
  });

  it('hashes the material and not the report', async () => {
    const property = await listing();
    const base = {
      reportedType: ModerationReportedType.PROPERTY,
      reportedId: String(property._id),
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
      reason: ListingReportReason.SCAM,
    };

    const byOne = await buildModerationReportInput({ ...base, id: 'r1', reporter: 'oxy-a' });
    const byAnother = await buildModerationReportInput({ ...base, id: 'r2', reporter: 'oxy-b' });

    // Two people reporting the same listing describe the same material. A hash
    // that included the reporter would be the opposite of what it is for.
    expect(byOne?.snapshotHash).toBe(byAnother?.snapshotHash);
    expect(byOne?.snapshotHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('is a defect, not a state, when a type has no provider', async () => {
    await expect(
      buildModerationReportInput({
        id: 'r-evict',
        reportedType: ModerationReportedType.EVICTION_CASE,
        reportedId: String(new mongoose.Types.ObjectId()),
        reporter: 'oxy-reporter',
        reason: ListingReportReason.OTHER,
        createdAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(ModerationSubjectUnsupportedError);
  });

  it('returns null when the reported object is gone', async () => {
    expect(
      await buildModerationReportInput({
        id: 'r-gone',
        reportedType: ModerationReportedType.PROPERTY,
        reportedId: String(new mongoose.Types.ObjectId()),
        reporter: 'oxy-reporter',
        reason: ListingReportReason.SCAM,
        createdAt: new Date(),
      }),
    ).toBeNull();
  });

  it('hashes a differing snapshot differently', () => {
    const base = {
      subject: { externalId: 'p1', type: 'commerce.listing' as const },
      content: { type: 'text' as const, data: { text: 'one' } },
    };
    expect(snapshotHash(base)).not.toBe(
      snapshotHash({ ...base, content: { type: 'text', data: { text: 'two' } } }),
    );
  });
});

describe('report taxonomy', () => {
  it.each([
    [ModerationReportedType.PROPERTY, ListingReportReason.INACCURATE, 'commerce.misleading_listing'],
    [ModerationReportedType.PROPERTY, ListingReportReason.UNAVAILABLE, 'commerce.misleading_listing'],
    [ModerationReportedType.PROPERTY, ListingReportReason.SCAM, 'integrity.scam'],
    [ModerationReportedType.PROPERTY, ListingReportReason.PRIVACY, 'privacy.location_exposure'],
    [ModerationReportedType.PROPERTY, ListingReportReason.UNSAFE, 'commerce.unsafe_product'],
    [ModerationReportedType.PROPERTY, ListingReportReason.INAPPROPRIATE, 'other.policy_specific'],
    [ModerationReportedType.PROPERTY, ListingReportReason.OTHER, 'other.unclassifiable'],
    [ModerationReportedType.REVIEW, ReviewReportReason.FAKE, 'integrity.fraud'],
    [ModerationReportedType.REVIEW, ReviewReportReason.OFFENSIVE, 'harassment.insult'],
    [ModerationReportedType.REVIEW, ReviewReportReason.PERSONAL_DATA, 'privacy.personal_information'],
    [ModerationReportedType.REVIEW, ReviewReportReason.SPAM, 'integrity.spam'],
    [ModerationReportedType.REVIEW, ReviewReportReason.OTHER, 'other.unclassifiable'],
  ])('%s/%s alleges %s', (reportedType, reason, expected) => {
    expect(allegationForReport({ reportedType, reason })).toBe(expected);
  });

  /**
   * Reachable in practice, not only in theory: a report row written by an older
   * deployment carries whatever reason that deployment offered. A report with no
   * allegation is not a report.
   */
  it('falls back rather than producing no allegation', () => {
    expect(
      allegationForReport({
        reportedType: ModerationReportedType.PROPERTY,
        reason: 'a-reason-from-a-future-release',
      }),
    ).toBe('other.unclassifiable');
  });

  /**
   * A review's reason vocabulary is not a listing's. Reading the wrong table
   * would map `spam` correctly by luck and everything else wrongly.
   */
  it('reads the table for the reported type', () => {
    expect(
      allegationForReport({
        reportedType: ModerationReportedType.REVIEW,
        reason: ListingReportReason.INACCURATE,
      }),
    ).toBe('other.unclassifiable');
  });
});
