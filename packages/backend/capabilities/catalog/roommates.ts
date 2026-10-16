import type { CatalogTool } from '@oxy.so/contracts';

import {
  actTool,
  booleanInput,
  enumInput,
  idInput,
  objectInput,
  openObjectInput,
  optionalTextInput,
  pageInput,
  readTool,
} from './define';

export const ROOMMATE_TOOLS: readonly CatalogTool[] = [
  readTool({
    name: 'listRoommateProfiles',
    description:
      'Discover people with roommate matching enabled, scored against the person’s own preferences (needs a Homiio profile). Filters: gender, location, ageRange ({"min":25,"max":30} as JSON text), maxBudget, withPets, nonSmoking, minMatchPercentage.',
    capability: 'housing.roommates.read',
    input: objectInput({
      page: pageInput,
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      gender: enumInput(['male', 'female', 'any']),
      location: optionalTextInput(200),
      ageRange: optionalTextInput(100),
      maxBudget: { type: 'number', minimum: 0 },
      withPets: booleanInput,
      nonSmoking: booleanInput,
      minMatchPercentage: { type: 'number', minimum: 0, maximum: 100 },
    }),
  }),
  readTool({
    name: 'getRoommateStatus',
    description:
      'Read whether the person has roommate matching on and their stated roommate preferences.',
    capability: 'housing.roommates.read',
    input: objectInput({}),
  }),
  readTool({
    name: 'getRoommatePreferences',
    description: 'Read the person’s roommate preferences (null when never answered).',
    capability: 'housing.roommates.read',
    input: objectInput({}),
  }),
  actTool({
    name: 'updateRoommatePreferences',
    description:
      'Change some of the person’s roommate preferences (ageRange, gender, lifestyle, budget, moveInDate, leaseDuration, interests, location); fields not sent keep their value. enabled: true/false also turns matching on or off.',
    capability: 'housing.roommates.manage',
    capabilityPackage: 'administer',
    input: objectInput(
      { preferences: openObjectInput('The preference fields to change, and optionally enabled.') },
      ['preferences'],
    ),
  }),
  actTool({
    name: 'toggleRoommateMatching',
    description: 'Turn the person’s roommate matching on or off.',
    capability: 'housing.roommates.manage',
    capabilityPackage: 'administer',
    rollback: 'supported',
    input: objectInput({ enabled: booleanInput }, ['enabled']),
  }),
  readTool({
    name: 'listRoommateRequests',
    description: 'List the roommate requests the person sent and received.',
    capability: 'housing.roommates.read',
    input: objectInput({}),
  }),
  readTool({
    name: 'listRoommateRelationships',
    description: 'List the person’s roommate relationships.',
    capability: 'housing.roommates.read',
    input: objectInput({}),
  }),
  actTool({
    name: 'sendRoommateRequest',
    description:
      'Send a roommate request (with an optional message) to somebody who has roommate matching on. They are notified. Refuses oneself and a pair with a request already pending.',
    capability: 'housing.roommates.request',
    capabilityPackage: 'communicate',
    input: objectInput({ oxyUserId: idInput, message: optionalTextInput(1000) }, ['oxyUserId']),
  }),
  actTool({
    name: 'acceptRoommateRequest',
    description:
      'Accept a roommate request the person RECEIVED, creating the relationship; the sender is notified. Any other request answers not-found.',
    capability: 'housing.roommates.manage',
    capabilityPackage: 'administer',
    input: objectInput({ requestId: idInput }, ['requestId']),
  }),
  actTool({
    name: 'declineRoommateRequest',
    description:
      'Decline a roommate request the person RECEIVED; the sender is notified. Any other request answers not-found.',
    capability: 'housing.roommates.manage',
    capabilityPackage: 'administer',
    input: objectInput({ requestId: idInput }, ['requestId']),
  }),
  actTool({
    name: 'endRoommateRelationship',
    description:
      'End a roommate relationship the person is part of; the other person is notified. Anyone else’s answers not-found.',
    capability: 'housing.roommates.manage',
    capabilityPackage: 'administer',
    input: objectInput({ relationshipId: idInput }, ['relationshipId']),
  }),
];
