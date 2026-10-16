/**
 * Repair requests on a lease (`domain/maintenance.ts`). Every tool is scoped by
 * the repository to leases the effective account is a party to, so a request
 * on somebody else's tenancy answers not-found.
 */

import type { CatalogTool } from '@oxy.so/contracts';
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_COMMENT_MAX,
  MAINTENANCE_DESCRIPTION_MAX,
  MAINTENANCE_STATUSES,
  MAINTENANCE_TITLE_MAX,
  MAINTENANCE_URGENCIES,
} from '@homiio/shared-types';

import {
  actTool,
  booleanInput,
  enumInput,
  idInput,
  isoDateInput,
  limitInput,
  objectInput,
  pageInput,
  readTool,
  textInput,
} from './define';

const READ = 'housing.maintenance.read';
const MANAGE = 'housing.maintenance.manage';

export const MAINTENANCE_TOOLS: readonly CatalogTool[] = [
  readTool({
    name: 'listMyMaintenanceRequests',
    description:
      'List the repair requests on leases the person is a tenant, co-tenant or landlord of, newest first, each with the person’s role on its lease. Filter by lease, property or open requests only.',
    capability: READ,
    input: objectInput({
      leaseId: idInput,
      propertyId: idInput,
      openOnly: booleanInput,
      page: pageInput,
      limit: limitInput,
    }),
    limitKeys: [{ key: 'limit', kind: 'maximum_number' }],
  }),
  readTool({
    name: 'getMaintenanceRequest',
    description:
      'Read one repair request with its comment thread, status history and photo list. Not-found unless the person is a party to its lease.',
    capability: READ,
    input: objectInput({ requestId: idInput }, ['requestId']),
  }),
  actTool({
    name: 'createMaintenanceRequest',
    description:
      'Report a repair on a lease the person is a tenant or co-tenant of; the landlord is notified. A landlord cannot raise one (forbidden); a lease the person is not on answers not-found.',
    capability: MANAGE,
    capabilityPackage: 'communicate',
    input: objectInput(
      {
        leaseId: idInput,
        category: enumInput(MAINTENANCE_CATEGORIES),
        urgency: enumInput(MAINTENANCE_URGENCIES),
        title: textInput(MAINTENANCE_TITLE_MAX),
        description: textInput(MAINTENANCE_DESCRIPTION_MAX),
      },
      ['leaseId', 'category', 'title', 'description'],
    ),
  }),
  actTool({
    name: 'commentOnMaintenanceRequest',
    description:
      'Post a message on a repair request’s thread; the other party of the lease is notified.',
    capability: MANAGE,
    capabilityPackage: 'communicate',
    input: objectInput({ requestId: idInput, body: textInput(MAINTENANCE_COMMENT_MAX) }, [
      'requestId',
      'body',
    ]),
  }),
  actTool({
    name: 'transitionMaintenanceRequest',
    description:
      'Move a repair request to another status (acknowledge, schedule with `scheduledFor`, resolve, close, decline). A move the current status does not allow answers MAINTENANCE_TRANSITION_ILLEGAL; the other party is notified.',
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput(
      {
        requestId: idInput,
        status: enumInput(MAINTENANCE_STATUSES),
        scheduledFor: isoDateInput,
      },
      ['requestId', 'status'],
    ),
  }),
];
