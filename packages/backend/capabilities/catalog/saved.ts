import {
  ALERT_CHANNELS,
  HOUSING_ALERT_RULE_TYPES,
  PUSH_PRIVACY_MODES,
  WATCH_CADENCES,
} from '@homiio/shared-types';
import type { CatalogTool } from '@oxy.so/contracts';

import {
  actTool,
  booleanInput,
  enumInput,
  idInput,
  limitInput,
  objectInput,
  openObjectInput,
  optionalTextInput,
  readTool,
  textInput,
} from './define';

const READ = 'housing.saved.read';
const MANAGE = 'housing.saved.manage';

const folderFields = {
  description: optionalTextInput(500),
  color: optionalTextInput(32),
  icon: optionalTextInput(64),
} as const;

/** The alerting settings a saved search (a watch) carries. */
const watchSettings = {
  cadence: enumInput(WATCH_CADENCES),
  notificationsEnabled: {
    type: 'boolean',
    description: 'Legacy switch: true means instant alerts, false means off. `cadence` wins.',
  },
  channels: { type: 'array', items: enumInput(ALERT_CHANNELS), maxItems: 3 },
  alertRules: {
    type: 'array',
    maxItems: 20,
    items: {
      type: 'object',
      properties: {
        type: enumInput(HOUSING_ALERT_RULE_TYPES),
        enabled: booleanInput,
        threshold: { type: 'number', minimum: 0 },
      },
      required: ['type'],
      additionalProperties: false,
    },
  },
  mutedUntil: {
    type: ['string', 'null'],
    maxLength: 40,
    description: 'ISO timestamp until which alerts are muted; null clears it.',
  },
  pushPrivacyMode: enumInput(PUSH_PRIVACY_MODES),
  isPrimaryArea: booleanInput,
} as const;

const searchDefinition = {
  query: optionalTextInput(500),
  filters: openObjectInput('The search filters, as searchListings takes them.'),
  location: openObjectInput(
    "The searched area as a LocationSelection (`kind`: place, address_candidate, map_bounds, polygon or multi_area) — for a city, resolvePlace's `location`. The person's current position is never stored.",
  ),
} as const;

export const SAVED_TOOLS: readonly CatalogTool[] = [
  readTool({
    name: 'listSavedHomes',
    description:
      "The homes the person saved, most recently saved first, each with the save's notes and folder.",
    capability: READ,
    input: objectInput({}),
  }),
  actTool({
    name: 'saveHome',
    description:
      'Save a listing for the person, optionally with a note and into one of their folders (their default folder otherwise). Saving it again updates the note and folder.',
    capability: MANAGE,
    capabilityPackage: 'create',
    input: objectInput({ propertyId: idInput, notes: optionalTextInput(2000), folderId: idInput }, [
      'propertyId',
    ]),
  }),
  actTool({
    name: 'unsaveHome',
    description: 'Remove a listing from the person’s saved homes.',
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput({ propertyId: idInput }, ['propertyId']),
  }),
  actTool({
    name: 'updateSavedHomeNotes',
    description: "Replace the person's note on one of their saved homes (empty clears it).",
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput({ propertyId: idInput, notes: optionalTextInput(2000) }, ['propertyId']),
  }),
  readTool({
    name: 'listSavedFolders',
    description: "The person's folders of saved homes, with how many homes each holds.",
    capability: READ,
    input: objectInput({}),
  }),
  actTool({
    name: 'createSavedFolder',
    description:
      'Create a folder for saved homes. Folder names are unique per person (a duplicate is refused).',
    capability: MANAGE,
    capabilityPackage: 'create',
    input: objectInput({ name: textInput(100), ...folderFields }, ['name']),
  }),
  actTool({
    name: 'updateSavedFolder',
    description:
      "Rename or restyle one of the person's folders. The default folder cannot be changed.",
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput({ folderId: idInput, name: textInput(100), ...folderFields }, ['folderId']),
  }),
  actTool({
    name: 'deleteSavedFolder',
    description:
      "Delete one of the person's folders. Its homes stay saved, outside any folder. The default folder cannot be deleted.",
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput({ folderId: idInput }, ['folderId']),
  }),
  readTool({
    name: 'listSavedSearches',
    description:
      "The person's saved searches. Each is also a watch: its cadence, channels and alert rules say what they are told about.",
    capability: READ,
    input: objectInput({}),
  }),
  actTool({
    name: 'createSavedSearch',
    description:
      'Save a search (and watch it). Needs a name and either a location or search text. An alert rule that is not available yet is refused rather than silently stored.',
    capability: MANAGE,
    capabilityPackage: 'create',
    input: objectInput({ name: textInput(100), ...searchDefinition, ...watchSettings }, ['name']),
  }),
  actTool({
    name: 'updateSavedSearch',
    description: "Change one of the person's saved searches or its alert settings.",
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput(
      { searchId: idInput, name: textInput(100), ...searchDefinition, ...watchSettings },
      ['searchId'],
    ),
  }),
  actTool({
    name: 'deleteSavedSearch',
    description: "Delete one of the person's saved searches, and its alerts with it.",
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput({ searchId: idInput }, ['searchId']),
  }),
  actTool({
    name: 'setSavedSearchAlerts',
    description:
      "Switch a saved search's alerts on or off. Turning them back on keeps the cadence the person chose (instant when it was off).",
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput({ searchId: idInput, notificationsEnabled: booleanInput }, [
      'searchId',
      'notificationsEnabled',
    ]),
  }),
  readTool({
    name: 'listHousingAlerts',
    description:
      "The alerts the person's watches produced, newest first, optionally for one saved search (`watchId`).",
    capability: READ,
    input: objectInput({
      watchId: idInput,
      limit: limitInput,
      offset: { type: 'integer', minimum: 0, maximum: 100_000 },
    }),
    limitKeys: [{ key: 'limit', kind: 'maximum_number' }],
  }),
  readTool({
    name: 'getHousingAlert',
    description:
      '"Why did I get this?" — one alert with its stored explanation, its watch and the change behind it (`event: null` once that evidence has expired).',
    capability: READ,
    input: objectInput({ alertId: idInput }, ['alertId']),
  }),
  readTool({
    name: 'listRecentlyViewedHomes',
    description: 'The homes the person opened recently in Homiio, most recent first.',
    capability: READ,
    input: objectInput({ limit: limitInput }),
    limitKeys: [{ key: 'limit', kind: 'maximum_number' }],
  }),
  actTool({
    name: 'clearRecentlyViewedHomes',
    description: "Clear the person's recently-viewed history.",
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput({}),
  }),
];
