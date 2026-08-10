/**
 * Jurisdiction resources and the eviction retention sweep.
 *
 * Two things that look unrelated and share a property: both are policies that
 * are ONLY real if something runs them. A resource list nobody re-verifies keeps
 * asserting itself; a retention rule with no cron is a promise. `db/expiry.ts`
 * states the second one outright — *"Registering a target is only half of the
 * port"* — and this file is the check that the halves are joined.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';

import * as eviction from '../../controllers/eviction';
import { getDb } from '../../db/postgres';
import { evictionCases, jurisdictionResources, notifications } from '../../db/schema';
import { upsertJurisdictionResource } from '../../db/evictions/jurisdictionResourceRepository';
import { sweepEvictionArchive, ARCHIVE_AFTER_DAYS } from '../../services/evictionArchivalService';
import { runEvictionArchivalNow } from '../../services/cron';
import { resetGeoTables, seedGeoChain } from '../helpers/postgresGeoFixtures';
import { errorHandler } from '../../middlewares/errorHandler';
import { assertFound } from '../helpers/assertFound';

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await getDb().delete(notifications);
  await getDb().delete(evictionCases);
  await getDb().delete(jurisdictionResources);
});

function buildApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (oxyUserId) {
      const authed = req as unknown as { user: { id: string }; userId: string };
      authed.user = { id: oxyUserId };
      authed.userId = oxyUserId;
    }
    next();
  });
  app.get('/evictions/resources', (req, res, next) => eviction.listResources(req, res, next));
  app.get('/evictions', (req, res, next) => eviction.listEvictions(req, res, next));
  app.get('/evictions/:id', (req, res, next) => eviction.getEvictionById(req, res, next));
  app.post('/evictions', (req, res, next) => eviction.createEviction(req, res, next));
  app.use(errorHandler);
  return app;
}

function inDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

async function createCase(owner: string, overrides: Record<string, unknown> = {}) {
  const res = await request(buildApp(owner))
    .post('/evictions')
    .send({
      title: 'Desahucio en Carrer de Sants',
      description: 'Necesitamos presencia.',
      location: {
        label: 'Carrer de Sants, Barcelona',
        coordinates: [2.1734, 41.3851],
        city: 'Barcelona',
        countryCode: 'ES',
      },
      scheduledAt: inDays(7),
      contactInfo: { phone: '+34600111222' },
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.data.eviction.id as string;
}

describe('jurisdiction resources', () => {
  /** A region to hang a region-scoped resource on. */
  async function seedRegion(): Promise<string> {
    await resetGeoTables();
    const chain = await seedGeoChain({ countryCode: 'ES', regionName: 'Catalonia' });
    return chain.regionId;
  }

  it('returns only the requested country, national plus that region', async () => {
    const regionId = await seedRegion();
    const verifiedAt = new Date();

    await upsertJurisdictionResource({
      countryCode: 'ES',
      resourceType: 'official_info',
      title: 'National',
      url: 'https://example.org/es-national',
      source: 'Gobierno',
      verifiedAt,
      languages: ['es'],
    });
    await upsertJurisdictionResource({
      countryCode: 'ES',
      regionId,
      resourceType: 'tenant_union',
      title: 'Regional',
      url: 'https://example.org/es-regional',
      source: 'Sindicat',
      languages: ['ca'],
      verifiedAt,
    });
    await upsertJurisdictionResource({
      countryCode: 'FR',
      resourceType: 'official_info',
      title: 'French',
      url: 'https://example.org/fr-national',
      source: 'Gouvernement',
      verifiedAt,
      languages: ['fr'],
    });

    const withRegion = await request(buildApp()).get(
      `/evictions/resources?countryCode=ES&regionId=${regionId}`,
    );
    expect(withRegion.status).toBe(200);
    const titles = withRegion.body.data.resources.map((row: { title: string }) => row.title);
    // Region-scoped first: a local tenant union is more use than a national portal.
    expect(titles).toEqual(['Regional', 'National']);
    expect(titles).not.toContain('French');

    // Without a region, only the national rows — a resource belonging to a
    // DIFFERENT region must not leak in, which is the half a naive country match
    // gets wrong.
    const nationalOnly = await request(buildApp()).get('/evictions/resources?countryCode=ES');
    expect(
      nationalOnly.body.data.resources.map((row: { title: string }) => row.title),
    ).toEqual(['National']);
  });

  it('carries a disclaimer and a verification date on every entry', async () => {
    const verifiedAt = new Date();
    await upsertJurisdictionResource({
      countryCode: 'ES',
      resourceType: 'legal_aid',
      title: 'Justicia gratuita',
      url: 'https://example.org/es-legal-aid',
      source: 'Abogacía',
      verifiedAt,
      languages: ['es'],
    });

    const res = await request(buildApp()).get('/evictions/resources?countryCode=ES');
    expect(res.status).toBe(200);
    expect(res.body.data.disclaimer).toContain('does not provide legal advice');
    expect(res.body.data.resources[0].verifiedAt).toBe(verifiedAt.toISOString());
    expect(res.body.data.resources[0].source).toBe('Abogacía');
    expect(res.body.data.resources[0].languages).toEqual(['es']);
  });

  it('hides a resource whose validity has lapsed', async () => {
    const verifiedAt = new Date(Date.now() - 400 * DAY_MS);
    await upsertJurisdictionResource({
      countryCode: 'ES',
      resourceType: 'official_info',
      title: 'Stale',
      url: 'https://example.org/es-stale',
      source: 'Gobierno',
      verifiedAt,
      validUntil: new Date(Date.now() - DAY_MS),
      languages: ['es'],
    });

    const res = await request(buildApp()).get('/evictions/resources?countryCode=ES');
    expect(res.status).toBe(200);
    // A dead number in the worst week of somebody's life is worse than none.
    expect(res.body.data.resources).toEqual([]);
  });

  it('answers an unknown jurisdiction with an empty list rather than a neighbour', async () => {
    const res = await request(buildApp()).get('/evictions/resources?countryCode=IE');
    expect(res.status).toBe(200);
    expect(res.body.data.resources).toEqual([]);
    expect(res.body.data.countryCode).toBe('IE');
  });

  it('refuses a malformed country code', async () => {
    const res = await request(buildApp()).get('/evictions/resources?countryCode=España');
    expect(res.status).toBe(400);
  });
});

describe('archival sweep', () => {
  /** Age a case's `updated_at` past the archival cutoff. */
  async function ageCase(id: string, days: number): Promise<void> {
    await getDb().execute(
      sql`update eviction_cases
          set updated_at = now() - (${days}::text || ' days')::interval
          where id = ${id}`,
    );
  }

  it('archives a stale case: contact DELETED, exact cleared, precision reduced', async () => {
    const id = await createCase('oxy-owner', {
      householdAuthorizedExact: true,
      exactAddress: 'Carrer de Sants 42',
    });
    await ageCase(id, ARCHIVE_AFTER_DAYS + 1);

    const result = await sweepEvictionArchive();
    expect(result.archived).toBe(1);

    const [row] = await getDb().select().from(evictionCases).where(eq(evictionCases.id, id));
    assertFound(row, 'row');
    expect(row.archivedAt).not.toBeNull();
    // Deleted, not hidden. A hidden contact is still a contact.
    expect(row.contactPhone).toBeNull();
    expect(row.locationExactLongitude).toBeNull();
    expect(row.locationExactLatitude).toBeNull();
    expect(row.locationExactAddress).toBeNull();
    expect(row.locationPrecision).toBe('neighborhood');

    // And it leaves the public board while staying reachable by direct link, so
    // the anonymous outcome survives as evidence of a pattern.
    const board = await request(buildApp()).get('/evictions?global=true&status=upcoming');
    expect(board.body.data.evictions.map((c: { id: string }) => c.id)).not.toContain(id);

    const direct = await request(buildApp()).get(`/evictions/${id}`);
    expect(direct.status).toBe(200);
    expect(direct.body.data.title).toBe('Desahucio en Carrer de Sants');
  });

  it('leaves a recently-changed case alone', async () => {
    const id = await createCase('oxy-owner');
    await ageCase(id, ARCHIVE_AFTER_DAYS - 5);

    const result = await sweepEvictionArchive();
    expect(result.archived).toBe(0);

    const [row] = await getDb().select().from(evictionCases).where(eq(evictionCases.id, id));
    assertFound(row, 'row');
    expect(row.archivedAt).toBeNull();
    expect(row.contactPhone).toBe('+34600111222');
  });

  it('deletes a case archived long enough ago', async () => {
    const id = await createCase('oxy-owner');
    await getDb().execute(
      sql`update eviction_cases
          set archived_at = now() - interval '800 days',
              updated_at = now() - interval '800 days'
          where id = ${id}`,
    );

    const result = await sweepEvictionArchive();
    expect(result.deleted).toBe(1);
    expect(await getDb().select().from(evictionCases).where(eq(evictionCases.id, id))).toHaveLength(0);
  });

  it('is REACHABLE from the cron manager, not merely callable', async () => {
    // The check `db/expiry.ts` says the registry does not give you. Without it a
    // test can only prove "the sweep works when called directly", which does not
    // distinguish a wired job from an unwired one.
    const id = await createCase('oxy-owner');
    await ageCase(id, ARCHIVE_AFTER_DAYS + 1);

    await runEvictionArchivalNow();

    const [row] = await getDb().select().from(evictionCases).where(eq(evictionCases.id, id));
    assertFound(row, 'row');
    expect(row.archivedAt).not.toBeNull();
  });
});
