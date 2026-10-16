/**
 * The profile tools: the person's own profile through the write allow-list,
 * and anybody else's only in the PUBLIC scope.
 */

import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxy.so/db';

import { getDb } from '../../db/postgres';
import { profiles } from '../../db/schema';
import { callTool } from '../helpers/capabilityHarness';

const SUITE = uuidv7().slice(-8);
const ME = `oxy-prof-me-${SUITE}`;
const OTHER = `oxy-prof-other-${SUITE}`;

it('getMyProfile creates the person’s profile on first read, as the route does', async () => {
  const result = await callTool('getMyProfile', ME);
  expect(result.isError).toBe(false);
  expect(result.structuredContent.data).toMatchObject({ oxyUserId: ME });
  expect(await getDb().select().from(profiles).where(eq(profiles.oxyUserId, ME))).toHaveLength(1);
});

it('updateMyProfile writes the effective account’s row and ignores an injected owner', async () => {
  const result = await callTool('updateMyProfile', ME, {
    profile: { oxyUserId: OTHER, settings: { language: 'es' } },
  });
  expect(result.isError).toBe(false);
  expect(result.structuredContent.data).toMatchObject({ oxyUserId: ME });
  expect(await getDb().select().from(profiles).where(eq(profiles.oxyUserId, OTHER))).toHaveLength(
    0,
  );
});

it('getUserProfile serves somebody else in the public scope, and not-found when absent', async () => {
  await callTool('getMyProfile', OTHER);
  const result = await callTool('getUserProfile', ME, { oxyUserId: OTHER });
  expect(result.isError).toBe(false);
  expect(result.structuredContent.data).toMatchObject({ oxyUserId: OTHER });

  const missing = await callTool('getUserProfile', ME, { oxyUserId: `oxy-nobody-${SUITE}` });
  expect(missing.error).toMatchObject({ status: 404, code: 'PROFILE_NOT_FOUND' });
});
