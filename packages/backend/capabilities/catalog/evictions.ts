/**
 * The eviction solidarity board (`domain/evictions/*`).
 *
 * Reads return exactly what the route publishes to the effective account
 * (ADR 0003): the public disc rather than the point, the organiser's contact
 * only to a confirmed supporter, the exact location only through
 * `getExactEvictionLocation` to the case team or a live grant holder — and
 * every exact-location read is audited. Writes keep the routes' whitelists and
 * the public-text sanitiser. Reports are community reports only; nothing here
 * moderates somebody else's content.
 */

import type { CatalogTool } from '@oxy.so/contracts';

import {
  EVICTION_CASE_STATUSES,
  EVICTION_HELP_NEED_TYPES,
  EVICTION_LOCATION_ACCESS_PURPOSES,
  EVICTION_PUBLIC_PRECISIONS,
  EVICTION_REPORT_REASONS,
} from '../../db/schema/evictions';
import {
  actTool,
  booleanInput,
  enumInput,
  idInput,
  isoDateInput,
  limitInput,
  objectInput,
  optionalTextInput,
  pageInput,
  readTool,
  textInput,
} from './define';

const READ = 'housing.evictions.read';
const MANAGE = 'housing.evictions.manage';
const SUPPORT = 'housing.evictions.support';
const COMMENT = 'housing.evictions.comment';
const REPORT = 'housing.evictions.report';
const LOCATION_READ = 'housing.evictions.location.read';
const LOCATION_MANAGE = 'housing.evictions.location.manage';

const caseId = { caseId: idInput };
const paging = { page: pageInput, limit: limitInput };
const limitKeys: CatalogTool['limitKeys'] = [{ key: 'limit', kind: 'maximum_number' }];

const SORTS = ['soonest', 'distance', 'recently_updated', 'newest'] as const;
const ORGANISER_EVENT_TYPES = [
  'note',
  'correction_published',
  'legal_resource_added',
  'instructions_updated',
] as const;

const location = {
  type: 'object',
  description:
    'Where the eviction is. `coordinates` is [longitude, latitude] of the true point; it is used to draw the published disc and is NOT stored unless the household authorised exact storage.',
  properties: {
    label: textInput(200),
    coordinates: {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
    },
    precision: enumInput(EVICTION_PUBLIC_PRECISIONS),
    city: optionalTextInput(200),
    countryCode: optionalTextInput(2),
  },
  required: ['label', 'coordinates'],
  additionalProperties: false,
} as const;

const contactInfo = {
  type: 'object',
  description:
    'The organiser’s contact, shown only to confirmed supporters. A payload replaces the whole block.',
  properties: {
    phone: optionalTextInput(100),
    email: optionalTextInput(320),
    telegram: optionalTextInput(100),
    whatsapp: optionalTextInput(100),
    instructions: optionalTextInput(2000),
  },
  additionalProperties: false,
} as const;

const coverImage = {
  type: 'object',
  description: 'A photo the app already uploaded.',
  properties: { imageId: idInput, url: textInput(2000) },
  additionalProperties: false,
} as const;

const helpNeeds = {
  type: 'array',
  maxItems: EVICTION_HELP_NEED_TYPES.length,
  items: {
    type: 'object',
    properties: { type: enumInput(EVICTION_HELP_NEED_TYPES), note: optionalTextInput(500) },
    required: ['type'],
    additionalProperties: false,
  },
} as const;

/** The case fields `CREATABLE_EVICTION_FIELDS` admits. */
const caseFields = {
  title: textInput(200),
  description: textInput(4000),
  location,
  scheduledAt: isoDateInput,
  contactInfo,
  coverImage,
  agencyOxyAccountId: idInput,
  organizationOxyAccountId: idInput,
  helpNeeds,
  householdAuthorizedExact: {
    type: 'boolean',
    description:
      'Set ONLY when the affected household itself asked for its exact location to be stored. Never assume it.',
  },
  exactAddress: optionalTextInput(2000),
} as const;

export const EVICTION_TOOLS: readonly CatalogTool[] = [
  // ── Reads ────────────────────────────────────────────────────────────────
  readTool({
    name: 'listEvictionCases',
    description:
      'Browse the eviction solidarity board in ONE named area: a `city`, a bounding box (swLat, swLng, neLat, neLng), a centre (`lat`, `lng`, optional `radius` in metres, max 100 km), `following`, `attending`, or `global: true` to browse everywhere on purpose. With no area it refuses with LOCATION_SCOPE_REQUIRED — never guess a worldwide feed. Locations are the published approximate disc.',
    capability: READ,
    input: objectInput({
      global: booleanInput,
      following: booleanInput,
      attending: booleanInput,
      city: textInput(200),
      swLat: { type: 'number', minimum: -90, maximum: 90 },
      swLng: { type: 'number', minimum: -180, maximum: 180 },
      neLat: { type: 'number', minimum: -90, maximum: 90 },
      neLng: { type: 'number', minimum: -180, maximum: 180 },
      lat: { type: 'number', minimum: -90, maximum: 90 },
      lng: { type: 'number', minimum: -180, maximum: 180 },
      radius: { type: 'number', exclusiveMinimum: 0, maximum: 100_000 },
      status: enumInput(EVICTION_CASE_STATUSES),
      scheduledFrom: isoDateInput,
      scheduledTo: isoDateInput,
      helpNeed: enumInput(EVICTION_HELP_NEED_TYPES),
      updatedWithinDays: { type: 'integer', minimum: 1, maximum: 3650 },
      organizationId: idInput,
      sort: enumInput(SORTS),
      ...paging,
    }),
    limitKeys,
  }),
  readTool({
    name: 'getEvictionCase',
    description:
      'Read one eviction case with its timeline and help needs, at the precision it is published to this person. The organiser’s contact appears only once the person is a confirmed supporter.',
    capability: READ,
    input: objectInput(caseId, ['caseId']),
  }),
  readTool({
    name: 'listEvictionComments',
    description: 'Read a case’s public coordination thread, newest first.',
    capability: READ,
    input: objectInput({ ...caseId, ...paging }, ['caseId']),
    limitKeys,
  }),
  readTool({
    name: 'listEvictionResources',
    description:
      'List verified legal and housing resources for a country (two-letter ISO code), optionally one region, with the disclaimer that must be shown with them. An empty list means nothing is verified there yet; never invent legal advice.',
    capability: READ,
    input: objectInput(
      {
        countryCode: { type: 'string', minLength: 2, maxLength: 2 },
        regionId: idInput,
      },
      ['countryCode'],
    ),
  }),
  readTool({
    name: 'listMyEvictionCases',
    description: 'List the eviction cases the person opened, archived ones included.',
    capability: READ,
    input: objectInput(paging),
    limitKeys,
  }),
  readTool({
    name: 'listAttendingEvictionCases',
    description: 'List the eviction cases the person said they will attend, soonest first.',
    capability: READ,
    input: objectInput(paging),
    limitKeys,
  }),
  readTool({
    name: 'listFollowedEvictionCases',
    description: 'List the eviction cases the person follows, soonest first.',
    capability: READ,
    input: objectInput(paging),
    limitKeys,
  }),
  readTool({
    name: 'getEvictionTeam',
    description:
      'Read a case’s team (creator and collaborators). Only a member of the team gets it; anyone else gets not-found.',
    capability: READ,
    input: objectInput(caseId, ['caseId']),
  }),

  // ── The case ─────────────────────────────────────────────────────────────
  actTool({
    name: 'reportEvictionCase',
    description:
      'Publish a new eviction case on the board as the person: title, description, location, scheduled date, optional contact, help needs and organisation. Addresses and phone numbers in free text are removed before publishing (the result says which categories); the exact point is published only as an approximate disc.',
    capability: MANAGE,
    capabilityPackage: 'publish',
    input: objectInput(caseFields, ['title', 'description', 'location', 'scheduledAt']),
  }),
  actTool({
    name: 'updateEvictionCase',
    description:
      'Edit a case the person created or collaborates on (any of the creation fields, plus `status`). An impossible status move answers INVALID_STATUS_TRANSITION; followers are notified of date and status changes once.',
    capability: MANAGE,
    capabilityPackage: 'publish',
    input: objectInput({ ...caseId, ...caseFields, status: enumInput(EVICTION_CASE_STATUSES) }, [
      'caseId',
    ]),
  }),
  actTool({
    name: 'deleteEvictionCase',
    description:
      'Delete a case the person created, with its thread, timeline and roster. Collaborators cannot; anyone else gets not-found.',
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput(caseId, ['caseId']),
  }),
  actTool({
    name: 'postEvictionUpdate',
    description:
      'Add an entry to a case’s public timeline as its creator or a collaborator — a note, a correction, a legal resource, new instructions, or a new date/status (which also updates the case). Followers are notified once.',
    capability: MANAGE,
    capabilityPackage: 'publish',
    input: objectInput(
      {
        ...caseId,
        message: textInput(2000),
        eventType: enumInput(ORGANISER_EVENT_TYPES),
        newScheduledAt: isoDateInput,
        newStatus: enumInput(EVICTION_CASE_STATUSES),
      },
      ['caseId', 'message'],
    ),
  }),
  actTool({
    name: 'clearEvictionHold',
    description:
      'As the case creator, answer a precautionary hold after fixing the location or description, publishing it again with a timeline note. A case that is not held, or not theirs, answers not-found.',
    capability: MANAGE,
    capabilityPackage: 'publish',
    input: objectInput({ ...caseId, message: optionalTextInput(500) }, ['caseId']),
  }),

  // ── Supporters and followers ──────────────────────────────────────────────
  actTool({
    name: 'toggleEvictionAttendance',
    description:
      'Say the person will attend a case, or withdraw that (it toggles). Attending tries to confirm them as a supporter at once; the result says whether they are confirmed.',
    capability: SUPPORT,
    capabilityPackage: 'create',
    input: objectInput(caseId, ['caseId']),
  }),
  actTool({
    name: 'toggleEvictionFollow',
    description:
      'Follow a case’s updates, or stop following it (it toggles). Following is not attending.',
    capability: SUPPORT,
    capabilityPackage: 'create',
    input: objectInput(caseId, ['caseId']),
  }),
  actTool({
    name: 'vouchForSupporter',
    description:
      'As a confirmed supporter of a case, vouch for another person (by Oxy id) who asked you to, which can confirm them. Unconfirmed supporters are refused.',
    capability: SUPPORT,
    capabilityPackage: 'administer',
    input: objectInput({ ...caseId, oxyUserId: idInput }, ['caseId', 'oxyUserId']),
  }),
  actTool({
    name: 'revokeSupporter',
    description:
      'As the case creator, withdraw one supporter’s confirmed access (by Oxy id). The roster is never listed, so the id must be one the creator already knows.',
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput({ ...caseId, oxyUserId: idInput }, ['caseId', 'oxyUserId']),
  }),
  actTool({
    name: 'addEvictionCollaborator',
    description:
      'As the case creator, add an Oxy account as a collaborator who may edit the case and read its exact address. Requires `acknowledgeExactLocationAccess: true`.',
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput(
      { ...caseId, oxyUserId: idInput, acknowledgeExactLocationAccess: booleanInput },
      ['caseId', 'oxyUserId', 'acknowledgeExactLocationAccess'],
    ),
  }),
  actTool({
    name: 'removeEvictionCollaborator',
    description: 'As the case creator, remove a collaborator.',
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput({ ...caseId, oxyUserId: idInput }, ['caseId', 'oxyUserId']),
  }),

  // ── Exact location ───────────────────────────────────────────────────────
  readTool({
    name: 'getExactEvictionLocation',
    description:
      'Read a case’s exact location, only when the household authorised exact storage AND the person is on the case team or holds a live grant. Every attempt is audited; a refusal says which gate refused (LOCATION_ACCESS_*). Never repeat the result in public text.',
    capability: LOCATION_READ,
    input: objectInput(caseId, ['caseId']),
  }),
  readTool({
    name: 'listEvictionLocationGrants',
    description: 'As the case creator, list the live exact-location grants.',
    capability: LOCATION_READ,
    input: objectInput(caseId, ['caseId']),
  }),
  readTool({
    name: 'getEvictionLocationAudit',
    description: 'As the case creator, read who was granted, refused or shown the exact location.',
    capability: LOCATION_READ,
    input: objectInput(caseId, ['caseId']),
  }),
  actTool({
    name: 'grantEvictionLocation',
    description:
      'As the case creator, give one person time-limited access to the exact location for a concrete purpose (legal_representation, accompaniment or emergency_housing).',
    capability: LOCATION_MANAGE,
    capabilityPackage: 'administer',
    input: objectInput(
      {
        ...caseId,
        granteeOxyUserId: idInput,
        purpose: enumInput(EVICTION_LOCATION_ACCESS_PURPOSES),
        hours: { type: 'number', exclusiveMinimum: 0, maximum: 24 * 365 },
      },
      ['caseId', 'granteeOxyUserId', 'purpose', 'hours'],
    ),
  }),
  actTool({
    name: 'revokeEvictionLocationGrant',
    description: 'As the case creator, revoke one person’s exact-location grant.',
    capability: LOCATION_MANAGE,
    capabilityPackage: 'administer',
    input: objectInput({ ...caseId, granteeOxyUserId: idInput }, ['caseId', 'granteeOxyUserId']),
  }),

  // ── Thread and reports ──────────────────────────────────────────────────
  actTool({
    name: 'commentOnEviction',
    description: 'Post a comment on a case’s public thread; the creator is notified.',
    capability: COMMENT,
    capabilityPackage: 'publish',
    input: objectInput({ ...caseId, body: textInput(2000) }, ['caseId', 'body']),
  }),
  actTool({
    name: 'deleteEvictionComment',
    description:
      'Delete a comment the person wrote, or any comment on a case they created. Anyone else gets not-found.',
    capability: COMMENT,
    capabilityPackage: 'administer',
    input: objectInput({ ...caseId, commentId: idInput }, ['caseId', 'commentId']),
  }),
  actTool({
    name: 'reportEvictionContent',
    description:
      'File a community report on a case (false information, exposed personal data, too precise, outdated, harassment, spam, dangerous contact). Details are required for false_information and personal_data_exposed. Re-reporting returns the existing report. This is not moderation: nothing is removed.',
    capability: REPORT,
    capabilityPackage: 'communicate',
    input: objectInput(
      {
        ...caseId,
        reason: enumInput(EVICTION_REPORT_REASONS),
        details: optionalTextInput(4000),
        contactEmail: optionalTextInput(320),
      },
      ['caseId', 'reason'],
    ),
  }),
];
