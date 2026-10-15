import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { publicApiBodyErrorHandler, publicApiRouter } from '../../routes/publicApi';
import { getDb } from '../../db/postgres';
import { evictionCases } from '../../db/schema/evictions';

const app = express();
app.use(express.json());
app.use(publicApiBodyErrorHandler);
app.use('/api/v1', publicApiRouter);
let id: string;
beforeEach(async () => {
  const [row] = await getDb()
    .insert(evictionCases)
    .values({
      oxyUserId: 'private-owner',
      title: 'Support Carrer de Sants 42, 3r 2a',
      description: 'private description',
      locationLabel: 'PRIVATE address never in cards',
      locationLongitude: 2.17,
      locationLatitude: 41.38,
      locationCity: 'Barcelona',
      locationCountryCode: 'ES',
      scheduledAt: new Date('2026-10-18T09:00:00Z'),
      locationExactAddress: 'Private address',
      locationExactLongitude: 2.12345,
      locationExactLatitude: 41.12345,
      locationHouseholdAuthorizedAt: new Date(),
      contactPhone: '+34600000000',
    })
    .returning({ id: evictionCases.id });
  id = row.id;
});
afterEach(async () => {
  await getDb().delete(evictionCases).where(eq(evictionCases.id, id));
});

test('public batch is deduplicated, ordered and contains only public projection', async () => {
  const res = await request(app)
    .post('/api/v1/cases/batch')
    .send({ ids: ['missing', id, id] })
    .expect(200);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.body).toEqual({
    items: [
      {
        id,
        title: 'Support Carrer de Sants,',
        area: { label: 'Barcelona', precision: 'area' },
        scheduledAt: '2026-10-18T09:00:00.000Z',
        status: 'upcoming',
        url: `https://homiio.com/evictions/${id}`,
      },
    ],
    unavailableIds: ['missing'],
  });
});
test.each(['archivedAt', 'precautionaryHoldAt'] as const)(
  'live %s withdrawal removes previously visible cards',
  async (field) => {
    expect(
      (
        await request(app)
          .post('/api/v1/cases/batch')
          .send({ ids: [id] })
      ).body.items,
    ).toHaveLength(1);
    await getDb()
      .update(evictionCases)
      .set({ [field]: new Date() })
      .where(eq(evictionCases.id, id));
    const res = await request(app)
      .post('/api/v1/cases/batch')
      .send({ ids: [id] })
      .expect(200);
    expect(res.body).toEqual({ items: [], unavailableIds: [id] });
  },
);
test('deletion is indistinguishable from missing and limits apply before deduplication', async () => {
  await getDb().delete(evictionCases).where(eq(evictionCases.id, id));
  expect(
    (
      await request(app)
        .post('/api/v1/cases/batch')
        .send({ ids: [id] })
        .expect(200)
    ).body,
  ).toEqual({ items: [], unavailableIds: [id] });
  await request(app)
    .post('/api/v1/cases/batch')
    .send({ ids: Array(51).fill(id) })
    .expect(422);
  for (const payload of [{ ids: [] }, { ids: [12] }, { ids: [id], unexpected: true }]) {
    const res = await request(app).post('/api/v1/cases/batch').send(payload).expect(400);
    expect(res.body.error.code).toBe('bad_request');
  }
  await request(app)
    .post('/api/v1/cases/batch?extra=true')
    .send({ ids: [id] })
    .expect(400);
});
test('serves generated schema and typed unknown-route errors', async () => {
  expect((await request(app).get('/api/v1/openapi.json').expect(200)).body.openapi).toBe('3.1.0');
  expect((await request(app).get('/api/v1/no-such-route').expect(404)).body.error.code).toBe(
    'unknown_route',
  );
});

test('malformed JSON has a typed error and never echoes request content', async () => {
  const res = await request(app)
    .post('/api/v1/cases/batch')
    .set('Content-Type', 'application/json')
    .send('{"private":')
    .expect(400);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.body).toEqual({ error: { code: 'bad_request', message: 'Invalid request body.' } });
});

test('legacy number-first addresses and contacts are reduced before cross-app publication', async () => {
  await getDb()
    .update(evictionCases)
    .set({ title: 'Support 42 Main Street, phone +34600000000', locationCity: '42 Main Street' })
    .where(eq(evictionCases.id, id));
  const res = await request(app)
    .post('/api/v1/cases/batch')
    .send({ ids: [id] })
    .expect(200);
  expect(res.body.items[0].title).toBe('Support Main Street, phone');
  expect(res.body.items[0].area.label).toBe('Main Street');
});
