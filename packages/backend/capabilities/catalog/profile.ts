import type { CatalogTool } from '@oxy.so/contracts';

import { actTool, idInput, objectInput, openObjectInput, readTool } from './define';

export const PROFILE_TOOLS: readonly CatalogTool[] = [
  readTool({
    name: 'getMyProfile',
    description:
      'Read the person’s own Homiio housing profile (personal profile, references, rental history, roommate preferences, settings). Creates an empty one on first use.',
    capability: 'housing.profile.read',
    input: objectInput({}),
  }),
  actTool({
    name: 'updateMyProfile',
    description:
      'Update the person’s own housing profile. Pass the blocks to change (e.g. personalProfile, settings); a block sent replaces that block, and fields outside the profile allow-list are ignored.',
    capability: 'housing.profile.manage',
    capabilityPackage: 'administer',
    input: objectInput(
      { profile: openObjectInput('The profile body, as PUT /api/profiles/me takes it.') },
      ['profile'],
    ),
  }),
  readTool({
    name: 'getUserProfile',
    description:
      'Read another person’s public housing profile by their Oxy account id; private blocks are withheld.',
    capability: 'housing.profiles.read',
    input: objectInput({ oxyUserId: idInput }, ['oxyUserId']),
  }),
];
