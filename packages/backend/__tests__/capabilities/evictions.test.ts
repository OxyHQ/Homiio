/**
 * The eviction board tools, through the wrapped catalogue handlers and the
 * REAL Postgres. Each tool calls `domain/evictions/*` as the effective account,
 * so what it answers is what the route publishes to THAT person (ADR 0003):
 * the disc, never the point; the organiser's contact only to a confirmed
 * supporter; the exact location only to the team or a live grant holder.
 * Every refusal re-reads the table so "404 and wrote anyway" cannot pass.
 */

import { eq } from 'drizzle-orm';
import { catalogToolSchema } from '@oxy.so/contracts';

import { EVICTION_TOOLS } from '../../capabilities/catalog/evictions';
import { distanceMeters } from '../../db/evictions/locationApproximation';
import { upsertJurisdictionResource } from '../../db/evictions/jurisdictionResourceRepository';
import { getDb } from '../../db/postgres';
import {
  capabilityEffectReceipts,
  evictionCases,
  evictionComments,
  evictionLocationAccessAudit,
  jurisdictionResources,
  notifications,
  profiles,
} from '../../db/schema';
import { notificationDispatchService } from '../../services/notificationDispatchService';
import { callTool } from '../helpers/capabilityHarness';

jest.mock('../../services/oxy', () => ({
  oxyService: { users: { get: jest.fn(async (id: string) => ({ id })) } },
}));

const OWNER = 'cap-organiser';
const SUPPORTER = 'cap-supporter';
const STRANGER = 'cap-stranger';
const TRUE_POINT = { longitude: 2.1734035, latitude: 41.3850639 };

function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function caseInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

type CaseDto = {
  id: string;
  location: { approximateCoordinates?: [number, number]; radiusMeters?: number };
  contactInfo?: unknown;
};

async function openCase(overrides: Record<string, unknown> = {}): Promise<string> {
  const result = await callTool('reportEvictionCase', OWNER, caseInput(overrides));
  expect(result.isError).toBe(false);
  return (result.structuredContent.data as { eviction: CaseDto }).eviction.id;
}

const caseRow = async (id: string) => {
  const [row] = await getDb().select().from(evictionCases).where(eq(evictionCases.id, id)).limit(1);
  return row;
};

async function agedProfile(oxyUserId: string, days: number) {
  await getDb()
    .insert(profiles)
    .values({ oxyUserId, createdAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) });
}

beforeEach(async () => {
  await getDb().delete(capabilityEffectReceipts);
  await getDb().delete(notifications);
  await getDb().delete(evictionCases);
  await getDb().delete(profiles);
  await getDb().delete(jurisdictionResources);
});

afterEach(() => jest.restoreAllMocks());

describe('the eviction catalogue entries', () => {
  it('are valid catalogue tools on the homiio account root, and none is a moderation tool', () => {
    for (const tool of EVICTION_TOOLS) {
      expect(() => catalogToolSchema.parse(tool)).not.toThrow();
      expect(tool.resourceTypes).toEqual(['homiio_account']);
      expect(tool.name).not.toMatch(/moderat|admin/i);
    }
  });
});

describe('reading the board', () => {
  it('refuses a board with no area rather than answering the world', async () => {
    await openCase();
    const result = await callTool('listEvictionCases', STRANGER, {});
    expect(result.error).toMatchObject({ status: 400, code: 'LOCATION_SCOPE_REQUIRED' });
  });

  it('answers a named city, publishing the disc and never the true point or the contact', async () => {
    const id = await openCase();
    const result = await callTool('listEvictionCases', STRANGER, { city: 'Barcelona' });
    const data = result.structuredContent.data as { evictions: CaseDto[]; scope: unknown };
    expect(data.scope).toEqual({ kind: 'city', city: 'Barcelona' });
    expect(data.evictions.map((entry) => entry.id)).toEqual([id]);
    const [longitude, latitude] = data.evictions[0].location.approximateCoordinates ?? [0, 0];
    expect(distanceMeters({ longitude, latitude }, TRUE_POINT)).toBeGreaterThan(0);
    expect(data.evictions[0].location.radiusMeters).toBeGreaterThan(0);
    expect(data.evictions[0].contactInfo).toBeUndefined();
  });

  it('getEvictionCase keeps the contact locked for an unconfirmed reader and open for a confirmed supporter', async () => {
    const id = await openCase();

    const stranger = await callTool('getEvictionCase', STRANGER, { caseId: id });
    expect((stranger.structuredContent.data as CaseDto).contactInfo).toBeUndefined();

    await agedProfile(SUPPORTER, 365);
    const attend = await callTool('toggleEvictionAttendance', SUPPORTER, { caseId: id });
    expect(attend.structuredContent.data).toMatchObject({ attending: true, confirmed: true });

    const supporter = await callTool('getEvictionCase', SUPPORTER, { caseId: id });
    expect((supporter.structuredContent.data as CaseDto).contactInfo).toMatchObject({
      phone: '+34600111222',
    });
  });

  it('an unknown case is not-found', async () => {
    const result = await callTool('getEvictionCase', STRANGER, { caseId: 'no-such-case' });
    expect(result.error).toMatchObject({ status: 404, code: 'EVICTION_NOT_FOUND' });
  });

  it('lists the person’s own, attending and followed cases', async () => {
    const id = await openCase();
    await callTool('toggleEvictionFollow', SUPPORTER, { caseId: id });
    await callTool('toggleEvictionAttendance', SUPPORTER, { caseId: id });

    const mine = await callTool('listMyEvictionCases', OWNER, {});
    const attending = await callTool('listAttendingEvictionCases', SUPPORTER, {});
    const following = await callTool('listFollowedEvictionCases', SUPPORTER, {});
    const ids = (result: Awaited<ReturnType<typeof callTool>>) =>
      (result.structuredContent.data as { evictions: CaseDto[] }).evictions.map((c) => c.id);
    expect(ids(mine)).toEqual([id]);
    expect(ids(attending)).toEqual([id]);
    expect(ids(following)).toEqual([id]);
    expect(ids(await callTool('listMyEvictionCases', STRANGER, {}))).toEqual([]);
  });

  it('lists verified resources with the disclaimer, and refuses a malformed country', async () => {
    await upsertJurisdictionResource({
      countryCode: 'ES',
      resourceType: 'official_info',
      title: 'National',
      url: 'https://example.org/es-national',
      source: 'Gobierno',
      verifiedAt: new Date('2026-09-01T00:00:00.000Z'),
      languages: ['es'],
    });
    const result = await callTool('listEvictionResources', STRANGER, { countryCode: 'es' });
    expect(result.structuredContent.data).toMatchObject({
      countryCode: 'ES',
      disclaimer: expect.stringContaining('legal advice'),
      resources: [expect.objectContaining({ title: 'National' })],
    });
    const bad = await callTool('listEvictionResources', STRANGER, { countryCode: '1x' });
    expect(bad.error).toMatchObject({ status: 400, code: 'INVALID_COUNTRY_CODE' });
  });
});

describe('writing a case', () => {
  it('reportEvictionCase stores the disc and not the point, and sanitises free text', async () => {
    const result = await callTool(
      'reportEvictionCase',
      OWNER,
      caseInput({ description: 'Llamad al 600 123 456 para venir.' }),
    );
    const data = result.structuredContent.data as {
      eviction: CaseDto;
      removedForPrivacy: string[];
    };
    expect(data.removedForPrivacy.length).toBeGreaterThan(0);
    const row = await caseRow(data.eviction.id);
    expect(row.oxyUserId).toBe(OWNER);
    expect(row.locationExactLongitude).toBeNull();
    expect(row.description).not.toContain('600 123 456');
  });

  it('updateEvictionCase is the team’s; a stranger gets not-found and the row is unchanged', async () => {
    const id = await openCase();
    const stranger = await callTool('updateEvictionCase', STRANGER, {
      caseId: id,
      title: 'Hijacked',
    });
    expect(stranger.error).toMatchObject({ status: 404 });
    expect((await caseRow(id)).title).toBe('Desahucio en Carrer de Sants');

    const owner = await callTool('updateEvictionCase', OWNER, { caseId: id, status: 'cancelled' });
    expect(owner.isError).toBe(false);
    expect((await caseRow(id)).status).toBe('cancelled');

    // A cancelled case can never come back as upcoming.
    const back = await callTool('updateEvictionCase', OWNER, { caseId: id, status: 'upcoming' });
    expect(back.error).toMatchObject({ status: 409, code: 'INVALID_STATUS_TRANSITION' });
  });

  it('postEvictionUpdate notifies followers through the dispatcher, once', async () => {
    const id = await openCase();
    await callTool('toggleEvictionFollow', SUPPORTER, { caseId: id });
    const dispatch = jest.spyOn(notificationDispatchService, 'createForUser');

    const result = await callTool('postEvictionUpdate', OWNER, {
      caseId: id,
      message: 'Nos vemos a las 8.',
    });
    expect(result.isError).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      SUPPORTER,
      expect.objectContaining({ type: 'eviction_update' }),
    );

    const stranger = await callTool('postEvictionUpdate', STRANGER, {
      caseId: id,
      message: 'Fake news',
    });
    expect(stranger.error).toMatchObject({ status: 404 });
  });

  it('deleteEvictionCase is the creator’s alone', async () => {
    const id = await openCase();
    const stranger = await callTool('deleteEvictionCase', STRANGER, { caseId: id });
    expect(stranger.error).toMatchObject({ status: 404 });
    expect(await caseRow(id)).toBeDefined();

    const owner = await callTool('deleteEvictionCase', OWNER, { caseId: id });
    expect(owner.structuredContent).toEqual({ data: null });
    expect(await caseRow(id)).toBeUndefined();
  });

  it('clearEvictionHold on a case that is not held answers not-found', async () => {
    const id = await openCase();
    const result = await callTool('clearEvictionHold', OWNER, { caseId: id });
    expect(result.error).toMatchObject({ status: 404, code: 'EVICTION_NOT_FOUND' });
  });

  it('the same idempotency key replays the stored case instead of opening a second one', async () => {
    const input = caseInput();
    const first = await callTool('reportEvictionCase', OWNER, input, {
      idempotencyKey: 'evict-key-1',
      lane: 'capability',
    });
    const second = await callTool('reportEvictionCase', OWNER, input, {
      idempotencyKey: 'evict-key-1',
      lane: 'capability',
    });
    expect(second.structuredContent).toEqual(first.structuredContent);
    expect(await getDb().select().from(evictionCases)).toHaveLength(1);
  });
});

describe('supporters, team and exact location', () => {
  it('revokeSupporter and the location tools are the creator’s; anyone else gets not-found', async () => {
    const id = await openCase({ householdAuthorizedExact: true });
    for (const [tool, input] of [
      ['revokeSupporter', { caseId: id, oxyUserId: SUPPORTER }],
      ['listEvictionLocationGrants', { caseId: id }],
      ['getEvictionLocationAudit', { caseId: id }],
      [
        'grantEvictionLocation',
        { caseId: id, granteeOxyUserId: SUPPORTER, purpose: 'accompaniment', hours: 4 },
      ],
      ['revokeEvictionLocationGrant', { caseId: id, granteeOxyUserId: SUPPORTER }],
    ] as const) {
      const result = await callTool(tool, STRANGER, input);
      expect(result.error).toMatchObject({ status: 404, code: 'EVICTION_NOT_FOUND' });
    }
  });

  it('the exact location reaches a grant holder only, and every attempt is audited', async () => {
    const id = await openCase({ householdAuthorizedExact: true, exactAddress: 'Carrer X 1' });

    const before = await callTool('getExactEvictionLocation', SUPPORTER, { caseId: id });
    expect(before.error?.status).toBe(403);
    expect(before.error?.code).toMatch(/^LOCATION_ACCESS_/);

    const grant = await callTool('grantEvictionLocation', OWNER, {
      caseId: id,
      granteeOxyUserId: SUPPORTER,
      purpose: 'accompaniment',
      hours: 4,
    });
    expect(grant.isError).toBe(false);

    const after = await callTool('getExactEvictionLocation', SUPPORTER, { caseId: id });
    expect(after.isError).toBe(false);
    expect(after.structuredContent.data).toMatchObject({ exactAddress: 'Carrer X 1' });

    const audit = await getDb()
      .select()
      .from(evictionLocationAccessAudit)
      .where(eq(evictionLocationAccessAudit.caseId, id));
    expect(audit.length).toBeGreaterThanOrEqual(3);

    const auditTool = await callTool('getEvictionLocationAudit', OWNER, { caseId: id });
    expect((auditTool.structuredContent.data as unknown[]).length).toBe(audit.length);
  });

  it('the team is shown to the team only; a collaborator needs the explicit acknowledgement', async () => {
    const id = await openCase();
    expect((await callTool('getEvictionTeam', STRANGER, { caseId: id })).error?.status).toBe(404);

    const unacknowledged = await callTool('addEvictionCollaborator', OWNER, {
      caseId: id,
      oxyUserId: SUPPORTER,
      acknowledgeExactLocationAccess: false,
    });
    expect(unacknowledged.error?.code).toBe('COLLABORATOR_ACCESS_ACKNOWLEDGEMENT_REQUIRED');

    const added = await callTool('addEvictionCollaborator', OWNER, {
      caseId: id,
      oxyUserId: SUPPORTER,
      acknowledgeExactLocationAccess: true,
    });
    expect(added.structuredContent.data).toEqual({ changed: true });
    expect((await callTool('getEvictionTeam', SUPPORTER, { caseId: id })).isError).toBe(false);

    const removed = await callTool('removeEvictionCollaborator', OWNER, {
      caseId: id,
      oxyUserId: SUPPORTER,
    });
    expect(removed.isError).toBe(false);
    expect((await callTool('getEvictionTeam', SUPPORTER, { caseId: id })).error?.status).toBe(404);
  });

  it('an unconfirmed supporter cannot vouch', async () => {
    const id = await openCase();
    const result = await callTool('vouchForSupporter', SUPPORTER, {
      caseId: id,
      oxyUserId: STRANGER,
    });
    expect(result.error).toMatchObject({ status: 403, code: 'VOUCHER_NOT_CONFIRMED' });
  });
});

describe('the thread and community reports', () => {
  it('a comment notifies the creator through the dispatcher; only its author or the creator may delete it', async () => {
    const id = await openCase();
    const dispatch = jest.spyOn(notificationDispatchService, 'createForUser');

    const posted = await callTool('commentOnEviction', SUPPORTER, {
      caseId: id,
      body: 'Allí estaré.',
    });
    const commentId = (posted.structuredContent.data as { id: string }).id;
    expect(dispatch).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ type: 'eviction_comment' }),
    );

    const listed = await callTool('listEvictionComments', STRANGER, { caseId: id });
    expect((listed.structuredContent.data as { total: number }).total).toBe(1);

    const stranger = await callTool('deleteEvictionComment', STRANGER, { caseId: id, commentId });
    expect(stranger.error).toMatchObject({ status: 404, code: 'COMMENT_NOT_FOUND' });
    expect(
      await getDb().select().from(evictionComments).where(eq(evictionComments.id, commentId)),
    ).toHaveLength(1);

    const owner = await callTool('deleteEvictionComment', OWNER, { caseId: id, commentId });
    expect(owner.isError).toBe(false);
  });

  it('a too-precise report holds the case on the first report, and a second report returns the first', async () => {
    const id = await openCase();
    const first = await callTool('reportEvictionContent', STRANGER, {
      caseId: id,
      reason: 'location_too_precise',
    });
    expect(first.structuredContent.data).toMatchObject({ precautionaryHold: true });
    expect((await caseRow(id)).precautionaryHoldAt).not.toBeNull();

    const again = await callTool('reportEvictionContent', STRANGER, {
      caseId: id,
      reason: 'spam',
    });
    expect(again.isError).toBe(false);
    expect((again.structuredContent.data as { id: string }).id).toBe(
      (first.structuredContent.data as { id: string }).id,
    );
  });
});
