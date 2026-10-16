/**
 * What every tool shares (`homiio.handlers.ts`): whose account it acts as,
 * its idempotency receipt, and how a refusal reaches the caller.
 *
 * Built on synthetic tools so the rules are pinned independently of any one
 * domain; the domain suites exercise the same wrapper through real tools.
 */

import type { CatalogTool } from '@oxy.so/contracts';
import type { InvocationContext } from '@oxy.so/mcp';
import { uuidv7 } from '@oxy.so/db';
import { eq } from 'drizzle-orm';

import { actTool, financeTool, objectInput, readTool } from '../../capabilities/catalog/define';
import type { HomiioToolHandler } from '../../capabilities/handlers/context';
import { buildHomiioInvocationHandlers } from '../../capabilities/homiio.handlers';
import { getDb } from '../../db/postgres';
import { capabilityEffectReceipts } from '../../db/schema';
import { AppError } from '../../middlewares/errorHandler';

const probe = readTool({
  name: 'probeRead',
  description: 'test',
  capability: 'housing.test.read',
  input: objectInput({}),
});
const effect = actTool({
  name: 'probeWrite',
  description: 'test',
  capability: 'housing.test.manage',
  capabilityPackage: 'create',
  input: objectInput({ note: { type: 'string' } }),
});
const money = financeTool({
  name: 'probeMoney',
  description: 'test',
  capability: 'housing.test.pay',
  input: objectInput({ amount: { type: 'number' } }, ['amount']),
  limitKeys: [{ key: 'amount', kind: 'maximum_number' }],
});

let effects = 0;
const handlers: Record<string, HomiioToolHandler> = {
  probeRead: async (_input, { accountId }) => ({ accountId, at: new Date(0), _id: 'x' }),
  probeWrite: async (input, { accountId }) => {
    effects += 1;
    if (input.note === 'refuse')
      throw new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND');
    if (input.note === 'crash') throw new Error('connection reset by peer at 10.0.0.1');
    return { accountId, effects };
  },
  probeMoney: async () => ({ ok: true }),
};

const wrapped = buildHomiioInvocationHandlers([probe, effect, money], handlers);

function oauthContext(tool: CatalogTool, activeAccountId: string, key?: string) {
  return {
    appId: 'homiio',
    tool,
    principal: {
      kind: 'oauth',
      subject: 'origin',
      clientId: 'claude',
      originAccountId: 'origin',
      activeAccountId,
      scopes: [],
      resource: 'https://mcp.homiio.com',
    },
    request: { requestInfo: { headers: key ? { 'idempotency-key': key } : {} } },
  } as unknown as InvocationContext;
}

function capabilityContext(tool: CatalogTool, effectiveAccountId: string) {
  return {
    appId: 'homiio',
    tool,
    principal: {
      kind: 'capability',
      claims: {
        requesterAccountId: 'requester-not-used',
        ownerAccountId: 'owner-not-used',
        resource: {
          appId: 'homiio',
          effectiveAccountId,
          resourceType: 'homiio_account',
          resourceId: effectiveAccountId,
        },
      },
    },
    request: { requestInfo: { headers: {} } },
  } as unknown as InvocationContext;
}

beforeEach(() => {
  effects = 0;
});

describe('the effective account', () => {
  it('is the OAuth connection’s ACTIVE account, not its origin', async () => {
    const result = await wrapped.probeRead({}, oauthContext(probe, 'active-member'));
    expect(result.structuredContent).toMatchObject({ accountId: 'active-member' });
  });

  it('is the ticket’s effectiveAccountId, not its requester or owner', async () => {
    const result = await wrapped.probeRead({}, capabilityContext(probe, 'effective'));
    expect(result.structuredContent).toMatchObject({ accountId: 'effective' });
  });
});

describe('the wire shape', () => {
  it('is what res.json would send: ids renamed, dates as ISO strings', async () => {
    const result = await wrapped.probeRead({}, oauthContext(probe, 'a'));
    expect(result.structuredContent).toEqual({
      accountId: 'a',
      at: '1970-01-01T00:00:00.000Z',
      id: 'x',
    });
  });
});

describe('refusals', () => {
  it('carry the domain’s code and status', async () => {
    const result = await wrapped.probeWrite({ note: 'refuse' }, oauthContext(effect, 'a'));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: { code: 'PROPERTY_NOT_FOUND', message: 'Property not found', status: 404 },
    });
  });

  it('never leak an unexpected error’s message', async () => {
    const result = await wrapped.probeWrite({ note: 'crash' }, oauthContext(effect, 'a'));
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('10.0.0.1');
    expect(result.structuredContent).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
  });

  it('refuse a required-idempotency tool without a key', async () => {
    const result = await wrapped.probeMoney({ amount: 1 }, oauthContext(money, 'a'));
    expect(result.structuredContent).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
  });
});

describe('idempotency receipts', () => {
  it('replay the stored result for the same key: the effect happens once', async () => {
    const account = uuidv7();
    const first = await wrapped.probeWrite({ note: 'a' }, oauthContext(effect, account, 'k1'));
    const retry = await wrapped.probeWrite({ note: 'a' }, oauthContext(effect, account, 'k1'));
    expect(first.structuredContent).toEqual({ accountId: account, effects: 1 });
    expect(retry.structuredContent).toEqual(first.structuredContent);
    expect(effects).toBe(1);
  });

  it('refuse the same key with different input', async () => {
    const account = uuidv7();
    await wrapped.probeWrite({ note: 'a' }, oauthContext(effect, account, 'k2'));
    const reused = await wrapped.probeWrite({ note: 'b' }, oauthContext(effect, account, 'k2'));
    expect(reused.structuredContent).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(effects).toBe(1);
  });

  it('are per account: another account’s key is its own', async () => {
    await wrapped.probeWrite({ note: 'a' }, oauthContext(effect, uuidv7(), 'shared'));
    await wrapped.probeWrite({ note: 'a' }, oauthContext(effect, uuidv7(), 'shared'));
    expect(effects).toBe(2);
  });

  it('release a failed effect, so an honest retry runs', async () => {
    const account = uuidv7();
    await wrapped.probeWrite({ note: 'refuse' }, oauthContext(effect, account, 'k3'));
    const rows = await getDb()
      .select()
      .from(capabilityEffectReceipts)
      .where(eq(capabilityEffectReceipts.oxyUserId, account));
    expect(rows).toHaveLength(0);
  });

  it('answer IDEMPOTENCY_IN_PROGRESS while the first call still holds its claim', async () => {
    const account = uuidv7();
    let release: () => void = () => undefined;
    const slow = buildHomiioInvocationHandlers([effect], {
      probeWrite: () =>
        new Promise((resolve) => {
          release = () => resolve({ done: true });
        }),
    });
    const first = slow.probeWrite({ note: 'a' }, oauthContext(effect, account, 'k4'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await slow.probeWrite({ note: 'a' }, oauthContext(effect, account, 'k4'));
    expect(second.structuredContent).toMatchObject({ error: { code: 'IDEMPOTENCY_IN_PROGRESS' } });
    release();
    expect((await first).structuredContent).toEqual({ done: true });
  });

  it('treat an expired, unswept receipt as absent', async () => {
    const account = uuidv7();
    await wrapped.probeWrite({ note: 'a' }, oauthContext(effect, account, 'k5'));
    await getDb()
      .update(capabilityEffectReceipts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(capabilityEffectReceipts.oxyUserId, account));
    await wrapped.probeWrite({ note: 'b' }, oauthContext(effect, account, 'k5'));
    expect(effects).toBe(2);
  });
});

describe('assembly', () => {
  it('refuses a tool without a handler and a handler without a tool', () => {
    expect(() => buildHomiioInvocationHandlers([probe], {})).toThrow(/without a handler/);
    expect(() => buildHomiioInvocationHandlers([], { probeRead: handlers.probeRead })).toThrow(
      /without a catalogue tool/,
    );
  });
});
