import type { CatalogTool } from '@oxy.so/contracts';

import { actTool, objectInput, readTool } from './define';

export const PARTNER_TOOLS: readonly CatalogTool[] = [
  actTool({
    name: 'joinPartnerProgram',
    description:
      'Join Homiio’s Partner (agent) referral program and get a referral link. Idempotent: joining again returns the existing partner, re-activated if dormant.',
    capability: 'housing.partners.manage',
    capabilityPackage: 'create',
    input: objectInput({}),
  }),
  readTool({
    name: 'getMyPartnerStatus',
    description:
      'Read the person’s Partner profile, referral link and stats (null partner and zeroed stats when they have not joined).',
    capability: 'housing.partners.read',
    input: objectInput({}),
  }),
  readTool({
    name: 'listMyReferrals',
    description: 'List the listings sourced through the person’s referral link, newest first.',
    capability: 'housing.partners.read',
    input: objectInput({}),
  }),
  readTool({
    name: 'getMyPartnerEarnings',
    description: 'Read the person’s Partner commission ledger, newest first.',
    capability: 'housing.partners.read',
    input: objectInput({}),
  }),
  readTool({
    name: 'getMyGuestPoints',
    description:
      'Read the person’s home-exchange guest-points balance and every movement behind it. Points are earned by hosting and spent by staying; nothing here changes them.',
    capability: 'housing.guestpoints.read',
    input: objectInput({}),
  }),
];
