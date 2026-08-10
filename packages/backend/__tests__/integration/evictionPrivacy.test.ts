/**
 * The eviction board's privacy contract, tested against a real PostgreSQL
 * server.
 *
 * Every test here is one of #358's *Pruebas obligatorias* or one of ADR 0003
 * §13's negative tests. They are in their own file because they are the ones
 * whose failure is a person's safety rather than a broken feature, and because a
 * privacy assertion buried in a 500-line behaviour suite is one somebody deletes
 * while fixing something else.
 *
 * ## Two defences every assertion here carries
 *
 * **A vacuity floor**, so a broken traversal cannot pass by finding nothing.
 * `expect(leaked).toEqual([])` is exactly what a scan over an empty field list
 * produces, which is why the private-field set is asserted to be non-trivially
 * sized BEFORE it is used.
 *
 * **Enumeration FROM THE SCHEMA**, not from a hand-maintained list. The private
 * columns come out of `PROTECTED_COLUMNS_BY_TABLE`, so a protected column added
 * next month is swept by this test without anybody editing it. A hand-written
 * list is a list that goes stale silently, and silently is the only way this
 * particular thing ever goes wrong.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';

import * as eviction from '../../controllers/eviction';
import { getDb } from '../../db/postgres';
import {
  evictionCases,
  evictionLocationAccessAudit,
  evictionLocationGrants,
  notifications,
  profiles,
} from '../../db/schema';
import { PROTECTED_COLUMNS_BY_TABLE } from '../../db/schema/protectedColumns';
import {
  distanceMeters,
  offsetWithinDisc,
} from '../../db/evictions/locationApproximation';
import { errorHandler } from '../../middlewares/errorHandler';
import { assertFound } from '../helpers/assertFound';

/** The exact point every fixture below reports. Never published, by design. */
const TRUE_POINT = { longitude: 2.1734035, latitude: 41.3850639 };

beforeEach(async () => {
  await getDb().delete(notifications);
  await getDb().delete(evictionCases);
  await getDb().delete(profiles);
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

  app.get('/evictions', (req, res, next) => eviction.listEvictions(req, res, next));
  app.get('/evictions/me/list', (req, res, next) => eviction.listMyEvictions(req, res, next));
  app.get('/evictions/:id', (req, res, next) => eviction.getEvictionById(req, res, next));
  app.get('/evictions/:id/location/exact', (req, res, next) =>
    eviction.getExactLocation(req, res, next),
  );
  app.get('/evictions/:id/location/audit', (req, res, next) =>
    eviction.getLocationAccessAudit(req, res, next),
  );
  app.post('/evictions', (req, res, next) => eviction.createEviction(req, res, next));
  app.put('/evictions/:id', (req, res, next) => eviction.updateEviction(req, res, next));
  app.post('/evictions/:id/attend', (req, res, next) => eviction.toggleAttend(req, res, next));
  app.post('/evictions/:id/report', (req, res, next) =>
    eviction.createEvictionReport(req, res, next),
  );
  app.post('/evictions/:id/location/grants', (req, res, next) =>
    eviction.createLocationGrant(req, res, next),
  );
  app.post('/evictions/:id/location/grants/:oxyUserId/revoke', (req, res, next) =>
    eviction.revokeLocationGrant(req, res, next),
  );

  app.use(errorHandler);
  return app;
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function caseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Desahucio en Carrer de Sants',
    description: 'Familia con menores. Necesitamos presencia.',
    location: {
      label: 'Carrer de Sants, Barcelona',
      coordinates: [TRUE_POINT.longitude, TRUE_POINT.latitude],
      city: 'Barcelona',
      countryCode: 'ES',
    },
    scheduledAt: inDays(7),
    contactInfo: { phone: '+34600111222', email: 'organiser@example.org' },
    ...overrides,
  };
}

async function createCase(
  owner: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await request(buildApp(owner)).post('/evictions').send(caseBody(overrides));
  expect(res.status).toBe(201);
  return res.body.data.eviction.id;
}

async function giveProfileAgedDays(oxyUserId: string, days: number): Promise<void> {
  await getDb()
    .insert(profiles)
    .values({ oxyUserId, createdAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) });
}

// ---------------------------------------------------------------------------
// 1. The public response never carries a private field — enumerated from the
//    schema, with a vacuity floor.
// ---------------------------------------------------------------------------

describe('public serializer carries no private field', () => {
  /**
   * The private column set, read out of the registry the TYPE-level exclusion is
   * computed from.
   *
   * Not a literal list: a column protected later is swept by this test with no
   * edit here, and a column REMOVED from the registry shrinks the floor below,
   * which fails loudly rather than quietly widening what may be published.
   */
  const PRIVATE_PROPERTIES = PROTECTED_COLUMNS_BY_TABLE.eviction_cases;

  it('has a non-trivial private-field set to sweep for', () => {
    // The vacuity floor. `expect(leaked).toEqual([])` over an EMPTY set passes
    // trivially and reads identically to a clean sweep, so the set's size is
    // asserted before anything uses it.
    expect(PRIVATE_PROPERTIES.length).toBeGreaterThanOrEqual(8);
    expect(PRIVATE_PROPERTIES).toContain('contactPhone');
    expect(PRIVATE_PROPERTIES).toContain('locationExactLongitude');
    expect(PRIVATE_PROPERTIES).toContain('locationExactAddress');
  });

  it('emits no private KEY and no private VALUE, on detail or on a list', async () => {
    const id = await createCase('oxy-owner', {
      householdAuthorizedExact: true,
      exactAddress: 'Carrer de Sants 42, 3r 2a',
    });

    // The stored row genuinely HOLDS the private values — a fixture with nothing
    // to leak cannot tell "does not leak it" from "there was nothing there".
    const [stored] = await getDb().select().from(evictionCases).where(eq(evictionCases.id, id));
    assertFound(stored, 'stored');
    expect(stored.locationExactLongitude).toBe(TRUE_POINT.longitude);
    expect(stored.locationExactLatitude).toBe(TRUE_POINT.latitude);
    expect(stored.locationExactAddress).toBe('Carrer de Sants 42, 3r 2a');
    expect(stored.contactPhone).toBe('+34600111222');

    const responses = await Promise.all([
      request(buildApp()).get(`/evictions/${id}`),
      request(buildApp('oxy-stranger')).get(`/evictions/${id}`),
      request(buildApp()).get('/evictions?global=true&status=upcoming'),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);

      // Vacuity floor per response: a tier-P field IS present, so an empty or
      // error body cannot pass this sweep by carrying nothing at all.
      expect(body).toContain('Desahucio en Carrer de Sants');
      expect(body.length).toBeGreaterThan(200);

      // No private KEY, in any casing the wire could plausibly use.
      for (const property of PRIVATE_PROPERTIES) {
        expect(body).not.toContain(`"${property}"`);
      }

      // No private VALUE. The exact coordinates are the mandatory one.
      expect(body).not.toContain(String(TRUE_POINT.longitude));
      expect(body).not.toContain(String(TRUE_POINT.latitude));
      expect(body).not.toContain('Carrer de Sants 42');
      expect(body).not.toContain('3r 2a');
    }
  });

  it('never carries organiser contact in a LIST response, for any role', async () => {
    await createCase('oxy-owner');

    for (const app of [buildApp(), buildApp('oxy-owner'), buildApp('oxy-stranger')]) {
      const res = await request(app).get('/evictions?global=true&status=upcoming');
      expect(res.status).toBe(200);
      expect(res.body.data.evictions.length).toBeGreaterThan(0);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('+34600111222');
      expect(body).not.toContain('organiser@example.org');
    }
  });

  it('keeps a notification free of the location and the contact', async () => {
    const id = await createCase('oxy-owner');
    await giveProfileAgedDays('oxy-supporter', 30);
    await request(buildApp('oxy-supporter')).post(`/evictions/${id}/attend`);
    await request(buildApp('oxy-owner'))
      .put(`/evictions/${id}`)
      .send({ scheduledAt: inDays(9) });

    const notes = await getDb()
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'eviction_update'));
    expect(notes.length).toBeGreaterThan(0);
    const payload = JSON.stringify(notes);
    // A notification is a PUBLICATION (ADR 0003 §4.6): whatever renders the push
    // sees the body, so the same rules apply to it as to a JSON response.
    expect(payload).not.toContain('+34600111222');
    expect(payload).not.toContain('organiser@example.org');
    expect(payload).not.toContain(String(TRUE_POINT.longitude));
    expect(payload).not.toContain(String(TRUE_POINT.latitude));
    // Vacuity floor: the payload really does carry the case id, so a scan over
    // an empty notification list cannot pass this.
    expect(payload).toContain(id);
  });

  it('carries no sensitive data on the deep link a share button would use', async () => {
    const id = await createCase('oxy-owner', { householdAuthorizedExact: true });
    const res = await request(buildApp()).get(`/evictions/${id}`);
    expect(res.status).toBe(200);

    // The deep link is `/evictions/<id>` and the id is an opaque uuid v7. The
    // response says an exact location EXISTS without carrying it, which is what
    // lets a client offer the request flow without becoming a disclosure.
    expect(res.body.data.id).toBe(id);
    expect(res.body.data.exactLocationAvailable).toBe(true);
    expect(res.body.data.location.approximateCoordinates).not.toEqual([
      TRUE_POINT.longitude,
      TRUE_POINT.latitude,
    ]);
    expect(id).not.toContain(String(TRUE_POINT.longitude));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ---------------------------------------------------------------------------
// 2. The approximation is server-side, and not trivially reversible.
// ---------------------------------------------------------------------------

describe('the published location is a server-generated disc', () => {
  it('publishes a centre and a radius, and neither is the reported point', async () => {
    const id = await createCase('oxy-owner');
    const res = await request(buildApp()).get(`/evictions/${id}`);
    expect(res.status).toBe(200);

    const location = res.body.data.location;
    expect(location.precision).toBe('approximate_radius');
    expect(location.radiusMeters).toBeGreaterThan(0);
    expect(location.approximateCoordinates).toHaveLength(2);
    expect(location.approximateCoordinates[0]).not.toBe(TRUE_POINT.longitude);
    expect(location.approximateCoordinates[1]).not.toBe(TRUE_POINT.latitude);

    // The true point IS inside the published disc — the statement is honest, not
    // merely vague.
    const published = {
      longitude: location.approximateCoordinates[0],
      latitude: location.approximateCoordinates[1],
    };
    expect(distanceMeters(published, TRUE_POINT)).toBeLessThanOrEqual(location.radiusMeters);
  });

  it('gives REPEATED fixtures at one point different, non-grid centres', async () => {
    // #358's "aproximación no reversible de forma trivial en fixtures repetidos".
    // The two trivially reversible shapes are a FIXED offset (every case moves
    // the same way) and a ROUNDING GRID (every case lands on the same lattice
    // point), and both would make these fixtures identical.
    const count = 12;
    const centres: { longitude: number; latitude: number; radiusMeters: number }[] = [];
    for (let index = 0; index < count; index += 1) {
      const id = await createCase('oxy-owner', { title: `repeat-${index}` });
      const res = await request(buildApp()).get(`/evictions/${id}`);
      centres.push({
        longitude: res.body.data.location.approximateCoordinates[0],
        latitude: res.body.data.location.approximateCoordinates[1],
        radiusMeters: res.body.data.location.radiusMeters,
      });
    }

    // (a) Every centre is distinct. A fixed offset or a grid gives duplicates.
    const distinct = new Set(centres.map((c) => `${c.longitude},${c.latitude}`));
    expect(distinct.size).toBe(count);

    // (b) Rounding to the OLD 3-decimal grid does not collapse them either —
    //     which is what the previous implementation would have done.
    const gridded = new Set(
      centres.map((c) => `${c.longitude.toFixed(3)},${c.latitude.toFixed(3)}`),
    );
    expect(gridded.size).toBeGreaterThan(1);

    // (c) The draws genuinely SPREAD across the disc rather than clustering on
    //     the true point. With uniform-in-area draws in a disc of radius R the
    //     expected maximum pairwise distance is ≈1.6R; 0.4R is a floor no
    //     healthy generator gets near.
    const radius = centres[0].radiusMeters;
    let maxPairwise = 0;
    for (let i = 0; i < centres.length; i += 1) {
      for (let j = i + 1; j < centres.length; j += 1) {
        maxPairwise = Math.max(maxPairwise, distanceMeters(centres[i], centres[j]));
      }
    }
    expect(maxPairwise).toBeGreaterThan(radius * 0.4);

    // (d) Every one of them is still a true statement.
    for (const centre of centres) {
      expect(distanceMeters(centre, TRUE_POINT)).toBeLessThanOrEqual(centre.radiusMeters);
    }
  });

  it('keeps the published centre when a resubmitted point is still inside the disc', async () => {
    const id = await createCase('oxy-owner');
    const before = await request(buildApp()).get(`/evictions/${id}`);
    const original = before.body.data.location.approximateCoordinates;

    // Re-saving the same location must NOT redraw: each redraw is an independent
    // sample around the true point, and a watcher collecting several of them can
    // average towards it.
    const res = await request(buildApp('oxy-owner'))
      .put(`/evictions/${id}`)
      .send({ location: caseBody().location });
    expect(res.status).toBe(200);
    expect(res.body.data.eviction.location.approximateCoordinates).toEqual(original);
  });

  it('redraws when the point moves outside the published disc', async () => {
    const id = await createCase('oxy-owner');
    const before = await request(buildApp()).get(`/evictions/${id}`);
    const original = before.body.data.location.approximateCoordinates;

    const res = await request(buildApp('oxy-owner'))
      .put(`/evictions/${id}`)
      .send({
        location: {
          label: 'Calle de Alcala, Madrid',
          coordinates: [-3.7038, 40.4168],
          city: 'Madrid',
          countryCode: 'ES',
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.data.eviction.location.approximateCoordinates).not.toEqual(original);
  });

  it('draws uniformly inside the disc, never outside it', () => {
    // Directly against the generator, so a change to the sampling maths is
    // caught without going through six HTTP round trips.
    for (let index = 0; index < 500; index += 1) {
      const drawn = offsetWithinDisc(TRUE_POINT, 400);
      expect(distanceMeters(drawn, TRUE_POINT)).toBeLessThanOrEqual(400.5);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Two requests with different roles get different data.
// ---------------------------------------------------------------------------

describe('two roles, two answers', () => {
  it('gives an anonymous viewer and the organiser materially different bodies', async () => {
    const id = await createCase('oxy-owner');

    const anonymous = await request(buildApp()).get(`/evictions/${id}`);
    const owner = await request(buildApp('oxy-owner')).get(`/evictions/${id}`);

    expect(anonymous.status).toBe(200);
    expect(owner.status).toBe(200);

    // The organiser sees the contact; nobody else does.
    expect(anonymous.body.data.contactInfo).toBeUndefined();
    expect(anonymous.body.data.contactLocked).toBe(true);
    expect(owner.body.data.contactInfo.phone).toBe('+34600111222');

    // And `isOwner` is ABSENT rather than false for the anonymous viewer, which
    // is what distinguishes "not asked" from "asked and no".
    expect(anonymous.body.data.isOwner).toBeUndefined();
    expect(owner.body.data.isOwner).toBe(true);

    // The two bodies are genuinely different — a vacuity floor for this test.
    expect(JSON.stringify(anonymous.body)).not.toEqual(JSON.stringify(owner.body));
  });
});

// ---------------------------------------------------------------------------
// 4. Access grants: expired, revoked, never issued.
// ---------------------------------------------------------------------------

describe('exact-location access grants', () => {
  async function authorizedCase(): Promise<string> {
    return createCase('oxy-owner', {
      householdAuthorizedExact: true,
      exactAddress: 'Carrer de Sants 42',
    });
  }

  it('refuses a caller with no grant, and AUDITS the refusal', async () => {
    const id = await authorizedCase();
    const res = await request(buildApp('oxy-lawyer')).get(`/evictions/${id}/location/exact`);
    expect(res.status).toBe(403);

    const audit = await getDb()
      .select()
      .from(evictionLocationAccessAudit)
      .where(eq(evictionLocationAccessAudit.caseId, id));
    const denials = audit.filter((row) => row.action === 'denied');
    // An audit that records only successes cannot answer "did anybody try".
    expect(denials).toHaveLength(1);
    expect(denials[0].denialReason).toBe('no_grant');
    expect(denials[0].actorOxyUserId).toBe('oxy-lawyer');
  });

  it('refuses even a granted caller when the household never authorised it', async () => {
    // No `householdAuthorizedExact`, so there is nothing stored to disclose. The
    // grant is not the only gate.
    const id = await createCase('oxy-owner');
    const grant = await request(buildApp('oxy-owner'))
      .post(`/evictions/${id}/location/grants`)
      .send({ granteeOxyUserId: 'oxy-lawyer', purpose: 'legal_representation', hours: 24 });
    expect(grant.status).toBe(409);

    const read = await request(buildApp('oxy-lawyer')).get(`/evictions/${id}/location/exact`);
    expect(read.status).toBe(403);
    expect(read.body.error?.code ?? read.body.code).toBe(
      'LOCATION_ACCESS_NOT_AUTHORIZED_BY_HOUSEHOLD',
    );
  });

  it('serves the exact location to a live grant, no-store, and audits the read', async () => {
    const id = await authorizedCase();
    const grant = await request(buildApp('oxy-owner'))
      .post(`/evictions/${id}/location/grants`)
      .send({ granteeOxyUserId: 'oxy-lawyer', purpose: 'legal_representation', hours: 24 });
    expect(grant.status).toBe(201);

    const res = await request(buildApp('oxy-lawyer')).get(`/evictions/${id}/location/exact`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.exactCoordinates).toEqual([TRUE_POINT.longitude, TRUE_POINT.latitude]);
    expect(res.body.data.exactAddress).toBe('Carrer de Sants 42');
    expect(res.body.data.accessPolicy.householdAuthorizedExact).toBe(true);

    const audit = await getDb()
      .select()
      .from(evictionLocationAccessAudit)
      .where(eq(evictionLocationAccessAudit.caseId, id));
    expect(audit.map((row) => row.action).sort()).toEqual(['granted', 'read']);
  });

  it('refuses an EXPIRED grant', async () => {
    const id = await authorizedCase();
    await request(buildApp('oxy-owner'))
      .post(`/evictions/${id}/location/grants`)
      .send({ granteeOxyUserId: 'oxy-lawyer', purpose: 'accompaniment', hours: 2 });

    // Age the whole grant, rather than dragging its deadline behind its issue
    // date: `eviction_location_grants_window_check` refuses `expires_at <=
    // granted_at`, and a grant that expired before it was issued is not the
    // state being modelled. Done in the DATABASE rather than by faking a clock,
    // because the predicate compares against Postgres' `now()` and a JS-side
    // clock change would not reach it — which is the point of putting the
    // deadline there.
    await getDb()
      .update(evictionLocationGrants)
      .set({
        grantedAt: new Date(Date.now() - 10 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 60_000),
      })
      .where(eq(evictionLocationGrants.caseId, id));

    const res = await request(buildApp('oxy-lawyer')).get(`/evictions/${id}/location/exact`);
    expect(res.status).toBe(403);
    expect(res.body.error?.code ?? res.body.code).toBe('LOCATION_ACCESS_EXPIRED');

    const audit = await getDb()
      .select()
      .from(evictionLocationAccessAudit)
      .where(eq(evictionLocationAccessAudit.caseId, id));
    expect(audit.some((row) => row.denialReason === 'expired')).toBe(true);
  });

  it('refuses a REVOKED grant', async () => {
    const id = await authorizedCase();
    await request(buildApp('oxy-owner'))
      .post(`/evictions/${id}/location/grants`)
      .send({ granteeOxyUserId: 'oxy-lawyer', purpose: 'accompaniment', hours: 24 });

    const before = await request(buildApp('oxy-lawyer')).get(`/evictions/${id}/location/exact`);
    expect(before.status).toBe(200);

    const revoke = await request(buildApp('oxy-owner')).post(
      `/evictions/${id}/location/grants/oxy-lawyer/revoke`,
    );
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.revoked).toBe(true);

    const after = await request(buildApp('oxy-lawyer')).get(`/evictions/${id}/location/exact`);
    expect(after.status).toBe(403);
    expect(after.body.error?.code ?? after.body.code).toBe('LOCATION_ACCESS_REVOKED');
  });

  it('clamps a grant to the maximum duration rather than honouring the request', async () => {
    const id = await authorizedCase();
    const res = await request(buildApp('oxy-owner'))
      .post(`/evictions/${id}/location/grants`)
      .send({ granteeOxyUserId: 'oxy-lawyer', purpose: 'accompaniment', hours: 24 * 365 });
    expect(res.status).toBe(201);
    const hours = (new Date(res.body.data.expiresAt).getTime() - Date.now()) / 3_600_000;
    // 72 hours is the ceiling. A grant that outlives the event it was issued for
    // is standing access wearing an expiry date.
    expect(hours).toBeLessThanOrEqual(72.1);
  });

  it('refuses a grant with no concrete purpose', async () => {
    const id = await authorizedCase();
    const res = await request(buildApp('oxy-owner'))
      .post(`/evictions/${id}/location/grants`)
      .send({ granteeOxyUserId: 'oxy-lawyer', purpose: 'other', hours: 4 });
    expect(res.status).toBe(400);
  });

  it('shows the audit to the organiser and refuses it to everybody else', async () => {
    const id = await authorizedCase();
    await request(buildApp('oxy-lawyer')).get(`/evictions/${id}/location/exact`);

    const owner = await request(buildApp('oxy-owner')).get(`/evictions/${id}/location/audit`);
    expect(owner.status).toBe(200);
    expect(owner.body.data.length).toBeGreaterThan(0);

    const stranger = await request(buildApp('oxy-stranger')).get(`/evictions/${id}/location/audit`);
    expect(stranger.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 5. Geographic scope: inside and outside, radius and bbox.
// ---------------------------------------------------------------------------

describe('geographic scope', () => {
  /** Barcelona and Madrid, far enough apart that no radius confuses them. */
  const BARCELONA = [2.1734, 41.3851];
  const MADRID = [-3.7038, 40.4168];

  async function twoCities(): Promise<void> {
    await createCase('oxy-owner', {
      title: 'bcn',
      location: { label: 'Carrer de Sants', coordinates: BARCELONA, city: 'Barcelona' },
    });
    await createCase('oxy-owner', {
      title: 'mad',
      location: { label: 'Calle de Alcala', coordinates: MADRID, city: 'Madrid' },
    });
  }

  it('includes a case inside a radius and excludes one outside it', async () => {
    await twoCities();
    const res = await request(buildApp()).get(
      `/evictions?lat=${BARCELONA[1]}&lng=${BARCELONA[0]}&radius=20000&status=upcoming`,
    );
    expect(res.status).toBe(200);
    const titles = res.body.data.evictions.map((row: { title: string }) => row.title);
    expect(titles).toEqual(['bcn']);
    expect(res.body.data.total).toBe(1);
  });

  it('includes a case inside a bounding box and excludes one outside it', async () => {
    await twoCities();
    const res = await request(buildApp()).get(
      '/evictions?swLat=41.2&swLng=2.0&neLat=41.5&neLng=2.3&status=upcoming',
    );
    expect(res.status).toBe(200);
    const titles = res.body.data.evictions.map((row: { title: string }) => row.title);
    expect(titles).toEqual(['bcn']);
    expect(res.body.data.total).toBe(1);
  });

  it('reports a distance only when the scope carried a centre', async () => {
    await twoCities();

    const scoped = await request(buildApp()).get(
      `/evictions?lat=${BARCELONA[1]}&lng=${BARCELONA[0]}&radius=20000&status=upcoming&sort=distance`,
    );
    expect(scoped.body.data.evictions[0].distanceMeters).toBeGreaterThanOrEqual(0);

    const global = await request(buildApp()).get('/evictions?global=true&status=upcoming');
    for (const row of global.body.data.evictions) {
      expect(row.distanceMeters).toBeUndefined();
    }
  });

  it('refuses sort=distance without a centre rather than answering with another order', async () => {
    await twoCities();
    const res = await request(buildApp()).get('/evictions?global=true&sort=distance');
    expect(res.status).toBe(400);
    expect(res.body.error?.code ?? res.body.code).toBe('INVALID_SORT');
  });

  it('scopes on the PUBLISHED point, so a bbox cannot bisect the true one', async () => {
    // A tight box around the true point misses the case whenever the published
    // centre landed elsewhere — which is the whole reason `location_geo` is
    // generated from the published pair. If the index were over the exact point,
    // this box would match every time and a caller could shrink it to a metre.
    const id = await createCase('oxy-owner', { title: 'tight' });
    const [stored] = await getDb().select().from(evictionCases).where(eq(evictionCases.id, id));
    assertFound(stored, 'stored');
    expect(stored.locationLongitude).not.toBe(TRUE_POINT.longitude);
    expect(stored.locationLatitude).not.toBe(TRUE_POINT.latitude);

    const res = await request(buildApp()).get(
      `/evictions?swLat=${TRUE_POINT.latitude - 0.00001}&swLng=${TRUE_POINT.longitude - 0.00001}` +
        `&neLat=${TRUE_POINT.latitude + 0.00001}&neLng=${TRUE_POINT.longitude + 0.00001}` +
        '&status=upcoming',
    );
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Free text cannot smuggle an address past the geometry.
// ---------------------------------------------------------------------------

describe('label and description sanitisation (ADR 0003 F9)', () => {
  it('strips a building number and a unit from the label and the description', async () => {
    const res = await request(buildApp('oxy-owner'))
      .post('/evictions')
      .send(
        caseBody({
          location: {
            label: 'Carrer de Sants 42, 3r 2a',
            coordinates: [TRUE_POINT.longitude, TRUE_POINT.latitude],
            city: 'Barcelona',
          },
          description: 'Quedamos en Carrer de Sants 42, piso 3. Llama al +34 600 111 222.',
        }),
      );
    expect(res.status).toBe(201);

    const published = res.body.data.eviction;
    // The STREET survives — it is what a supporter needs. The number and the
    // door do not.
    expect(published.location.label).toContain('Carrer de Sants');
    expect(published.location.label).not.toContain('42');
    expect(published.location.label).not.toContain('3r 2a');
    expect(published.description).not.toContain('42');
    expect(published.description).not.toContain('600 111 222');

    // The reporter is told which RULE fired, by category — never the value,
    // because this deployment logs response bodies on error.
    expect(res.body.data.removedForPrivacy).toContain('building_number');
    expect(res.body.data.removedForPrivacy).toContain('phone');
    expect(JSON.stringify(res.body.data.removedForPrivacy)).not.toContain('600');
  });
});

// ---------------------------------------------------------------------------
// 7. A data-exposure report holds the case precautionarily, without deleting it.
// ---------------------------------------------------------------------------

describe('precautionary hold on a privacy report', () => {
  it('withholds the location and the description on the FIRST such report', async () => {
    const id = await createCase('oxy-owner');

    const before = await request(buildApp()).get(`/evictions/${id}`);
    expect(before.body.data.location.approximateCoordinates).toBeDefined();
    expect(before.body.data.description).toBeDefined();

    const report = await request(buildApp('oxy-reporter'))
      .post(`/evictions/${id}/report`)
      .send({ reason: 'personal_data_exposed', details: 'The description names the household.' });
    expect(report.status).toBe(201);
    expect(report.body.data.precautionaryHold).toBe(true);

    const after = await request(buildApp()).get(`/evictions/${id}`);
    expect(after.status).toBe(200);
    // NOT deleted: existence, title, date, status and timeline stay public.
    expect(after.body.data.title).toBe('Desahucio en Carrer de Sants');
    expect(after.body.data.status).toBe('upcoming');
    expect(after.body.data.timeline.length).toBeGreaterThan(0);
    // Withheld: the point and the prose.
    expect(after.body.data.location.approximateCoordinates).toBeUndefined();
    expect(after.body.data.location.precision).toBe('neighborhood');
    expect(after.body.data.description).toBeUndefined();
    expect(after.body.data.moderation.precautionaryHold).toBe(true);

    // And the hold is on the timeline, as a SYSTEM event that names nobody.
    const holdEntry = after.body.data.timeline.find(
      (entry: { eventType: string }) => entry.eventType === 'precautionary_hold_applied',
    );
    expect(holdEntry).toBeDefined();
    expect(holdEntry.actor).toEqual({ kind: 'system' });
    expect(JSON.stringify(after.body.data.timeline)).not.toContain('oxy-reporter');
  });

  it('marks a case disputed at three distinct reporters', async () => {
    const id = await createCase('oxy-owner');
    for (const reporter of ['oxy-r1', 'oxy-r2', 'oxy-r3']) {
      await request(buildApp(reporter)).post(`/evictions/${id}/report`).send({ reason: 'spam' });
    }
    const res = await request(buildApp()).get(`/evictions/${id}`);
    expect(res.body.data.moderation.disputed).toBe(true);
    // Disputed is NOT deletion, and it is not a hold either.
    expect(res.body.data.moderation.precautionaryHold).toBe(false);
    expect(res.body.data.description).toBeDefined();
  });
});
