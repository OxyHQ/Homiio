/**
 * The Partner program and guest-points tools, scoped to the effective account.
 */

import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxy.so/db';

import { getDb } from '../../db/postgres';
import { partners } from '../../db/schema';
import { callTool } from '../helpers/capabilityHarness';

const SUITE = uuidv7().slice(-8);
const ME = `oxy-partner-me-${SUITE}`;
const OTHER = `oxy-partner-other-${SUITE}`;

it('joins idempotently as the effective account', async () => {
  const first = await callTool('joinPartnerProgram', ME);
  expect(first.isError).toBe(false);
  const firstPartner = (first.structuredContent.data as { partner: { id: string; userId: string } })
    .partner;
  expect(firstPartner.userId).toBe(ME);

  const again = await callTool('joinPartnerProgram', ME);
  expect((again.structuredContent.data as { partner: { id: string } }).partner.id).toBe(
    firstPartner.id,
  );
  expect(await getDb().select().from(partners).where(eq(partners.oxyUserId, ME))).toHaveLength(1);
});

it('reads only the effective account’s dashboard, referrals and earnings', async () => {
  await callTool('joinPartnerProgram', ME);
  const status = await callTool('getMyPartnerStatus', OTHER);
  expect(status.structuredContent.data).toMatchObject({ partner: null, link: null });

  expect((await callTool('listMyReferrals', OTHER)).structuredContent).toEqual({
    data: { properties: [] },
  });
  expect((await callTool('getMyPartnerEarnings', ME)).structuredContent).toEqual({
    data: { commissions: [] },
  });
});

it('reads the effective account’s guest points', async () => {
  const result = await callTool('getMyGuestPoints', ME);
  expect(result.isError).toBe(false);
  expect(result.structuredContent.data).toMatchObject({ movements: [] });
});
