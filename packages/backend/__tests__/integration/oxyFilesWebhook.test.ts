/**
 * `POST /webhooks/oxy/files` — Oxy's file events, end to end against Postgres.
 *
 * A takedown (`file.blocked`) must make the photo disappear from what Homiio
 * shows — the listing's photos, its `has_images`, an eviction case's cover —
 * and a reinstatement (`file.unblocked`) must bring it back. Delivery is at
 * least once and may be out of order; the signature is the only
 * authentication.
 */

import { createHmac } from 'node:crypto';

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxy.so/db';

import { getDb } from '../../db/postgres';
import { evictionCases, images, oxyFileEvents, properties } from '../../db/schema';
import { findPropertyById } from '../../db/properties/propertyReads';
import { replacePropertyImages } from '../../db/properties/propertyWrites';
import { createOxyFilesWebhookRoutes } from '../../routes/oxyFilesWebhook';
import { insertOxyImage } from '../../services/files/publicImages';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
} from '../helpers/postgresGeoFixtures';

const SECRET = process.env.OXY_FILES_WEBHOOK_SECRET as string;

function app(options: { parseFirst?: boolean } = {}): Express {
  const built = express();
  if (options.parseFirst) built.use(express.json());
  built.use('/webhooks', createOxyFilesWebhookRoutes());
  return built;
}

function signed(body: string, secret = SECRET, at = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', secret).update(`${at}.${body}`).digest('hex');
  return { 'content-type': 'application/json', 'oxy-signature': `t=${at},v1=${signature}` };
}

function event(
  type: string,
  fileId: string,
  status: string,
  occurredAt: Date,
  visibility = 'public',
) {
  return JSON.stringify({
    id: `evt-${uuidv7()}`,
    type,
    occurredAt: occurredAt.toISOString(),
    file: { id: fileId, ownerKind: 'application', visibility, status },
    references: [],
  });
}

async function post(body: string, headers: Record<string, string> = signed(body), target = app()) {
  let call = request(target).post('/webhooks/oxy/files');
  for (const [name, value] of Object.entries(headers)) call = call.set(name, value);
  return call.send(body);
}

/** A listing with one Oxy photo, and an eviction case using the same file as its cover. */
async function scene(fileId: string) {
  const chain = await seedGeoChain({ cityName: `Hookville ${uuidv7().slice(-6)}` });
  const addressId = await seedAddress({ chain, street: `Carrer ${uuidv7()}` });
  const propertyId = await seedProperty({ addressId });
  const stored = {
    fileId,
    owner: 'application' as const,
    format: 'jpeg',
    bytes: 1,
    sha256: 'b'.repeat(64),
  };
  const listingPhoto = await insertOxyImage('property', propertyId, stored);
  await replacePropertyImages(propertyId, [{ imageId: listingPhoto.id, isPrimary: true }]);

  const caseId = uuidv7();
  const cover = await insertOxyImage('eviction_case', caseId, stored);
  await getDb()
    .insert(evictionCases)
    .values({
      id: caseId,
      oxyUserId: 'organiser-1',
      title: 'Desahucio',
      description: 'Concentración.',
      locationLabel: 'Somewhere',
      locationLongitude: 2.17,
      locationLatitude: 41.38,
      scheduledAt: new Date('2030-01-01T09:00:00Z'),
      coverImageId: cover.id,
      coverImageUrl: cover.urlsMedium,
    });
  return { propertyId, caseId, coverUrl: cover.urlsMedium };
}

async function shown(propertyId: string): Promise<{ photos: number; hasImages: boolean }> {
  const hydrated = await findPropertyById(propertyId);
  const [row] = await getDb()
    .select({ hasImages: properties.hasImages })
    .from(properties)
    .where(eq(properties.id, propertyId));
  return { photos: hydrated?.images.length ?? -1, hasImages: row.hasImages };
}

async function caseCover(caseId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ url: evictionCases.coverImageUrl })
    .from(evictionCases)
    .where(eq(evictionCases.id, caseId));
  return row.url;
}

beforeEach(async () => {
  await resetGeoTables();
});

afterAll(async () => {
  await getDb().delete(evictionCases);
  await resetGeoTables();
});

describe('the endpoint', () => {
  it('echoes the verification challenge', async () => {
    const body = JSON.stringify({ type: 'webhook.challenge', challenge: 'abc123' });
    const res = await post(body, { 'content-type': 'application/json' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ challenge: 'abc123' });
  });

  it('refuses a wrong signature and changes nothing', async () => {
    const { propertyId } = await scene('file-badsig');
    const body = event('file.blocked', 'file-badsig', 'blocked', new Date());

    const res = await post(body, signed(body, 'whsec_somebody-else'));

    expect(res.status).toBe(400);
    expect(await shown(propertyId)).toEqual({ photos: 1, hasImages: true });
  });

  it('refuses a stale signature (replay window)', async () => {
    const body = event('file.blocked', 'file-stale', 'blocked', new Date());
    const res = await post(body, signed(body, SECRET, Math.floor(Date.now() / 1000) - 3600));
    expect(res.status).toBe(400);
  });

  it('fails loudly when a body parser ran first (mount order)', async () => {
    const body = event('file.deleted', 'file-mount', 'deleted', new Date());
    const res = await post(body, signed(body), app({ parseFirst: true }));
    expect(res.status).toBe(500);
  });
});

describe('what an event does', () => {
  it('hides a blocked photo everywhere, and brings it back when unblocked', async () => {
    const { propertyId, caseId, coverUrl } = await scene('file-claim');

    const blocked = await post(event('file.blocked', 'file-claim', 'blocked', new Date()));
    expect(blocked.status).toBe(204);
    expect(await shown(propertyId)).toEqual({ photos: 0, hasImages: false });
    expect(await caseCover(caseId)).toBeNull();

    const unblocked = await post(
      event('file.unblocked', 'file-claim', 'active', new Date(Date.now() + 1000)),
    );
    expect(unblocked.status).toBe(204);
    expect(await shown(propertyId)).toEqual({ photos: 1, hasImages: true });
    expect(await caseCover(caseId)).toBe(coverUrl);
  });

  it('hides a photo its owner made private', async () => {
    const { propertyId } = await scene('file-private');
    await post(event('file.visibility_changed', 'file-private', 'active', new Date(), 'private'));
    expect(await shown(propertyId)).toEqual({ photos: 0, hasImages: false });
  });

  it('applies a redelivery once', async () => {
    await scene('file-dup');
    const body = event('file.trashed', 'file-dup', 'trash', new Date());

    expect((await post(body)).status).toBe(204);
    expect((await post(body)).status).toBe(204);

    const id = (JSON.parse(body) as { id: string }).id;
    expect(await getDb().select().from(oxyFileEvents).where(eq(oxyFileEvents.id, id))).toHaveLength(
      1,
    );
  });

  it('does not let an older event undo a newer one', async () => {
    const { propertyId } = await scene('file-order');
    const now = Date.now();
    await post(event('file.blocked', 'file-order', 'blocked', new Date(now)));
    // An earlier `restored`, delivered late.
    await post(event('file.restored', 'file-order', 'active', new Date(now - 60_000)));

    expect(await shown(propertyId)).toEqual({ photos: 0, hasImages: false });
    const [row] = await getDb()
      .select({ status: images.oxyFileStatus })
      .from(images)
      .where(eq(images.oxyFileId, 'file-order'))
      .limit(1);
    expect(row.status).toBe('blocked');
  });
});
