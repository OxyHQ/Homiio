/**
 * A `MaintenanceRequest` read as Bloom's `MaintenanceRequestCard`.
 *
 * ## Two vocabularies that do not line up, and how the gap is closed
 *
 * Bloom's card was written against the Housing template's fixtures and carries
 * that demo's vocabulary. Homiio's domain is wider, and the differences are
 * real rather than cosmetic:
 *
 * | | Bloom | Homiio |
 * |---|---|---|
 * | category | 5 values, `appliances` | 8 values, `appliance`, plus structural/pest/security |
 * | priority | low, medium, high, urgent | low, normal, high, **emergency** |
 * | stage | reported → acknowledged → scheduled → resolved | + `closed` and `declined` |
 *
 * The card takes `categoryLabel`, `priorityLabel` and `stageLabels` overrides,
 * which is exactly the seam for this: Bloom decides the LAYOUT and the visual
 * treatment, Homiio decides the WORDS. So the mapping below picks the nearest
 * Bloom token for styling and always supplies Homiio's own translated label on
 * top of it — a structural repair is drawn with the `other` icon and reads
 * "Structural", never "Other".
 *
 * ## The two statuses Bloom has no stage for
 *
 * `closed` maps to `resolved` and `declined` to `acknowledged`, in both cases
 * with an overriding label. That is a choice about what the TIMELINE should
 * look like, and the alternatives are worse: mapping `declined` to `reported`
 * would draw a request the landlord has answered as though nobody had looked at
 * it, and inventing a fifth stage would mean not using Bloom's card at all.
 *
 * Nothing here reads the clock beyond formatting the dates it is given, and
 * nothing is invented: a request with no schedule gets no scheduled entry, and
 * a photo array is never produced because Homiio has no private attachment
 * store yet (see `docs/housing-parity.md`).
 */

import type { TFunction } from 'i18next';
import type {
  MaintenanceCategory as BloomCategory,
  MaintenancePriority as BloomPriority,
  MaintenanceRequestCardProps,
  MaintenanceStage as BloomStage,
  MaintenanceStageEntry,
} from '@oxy.so/bloom/tenancy';
import type {
  MaintenanceCategory,
  MaintenanceRequest,
  MaintenanceStatus,
  MaintenanceUrgency,
} from '@homiio/shared-types';

import { formatLocalized } from '@/utils/dateLocale';

/**
 * The nearest Bloom category, for the ICON only.
 *
 * Exhaustive over Homiio's eight, so adding a ninth is a compile error here
 * rather than a card that silently draws a wrench for a wasp nest.
 */
const BLOOM_CATEGORY: Record<MaintenanceCategory, BloomCategory> = {
  plumbing: 'plumbing',
  electrical: 'electrical',
  heating: 'heating',
  appliance: 'appliances',
  // Bloom has no icon for these three. `other` is the honest fallback; the
  // LABEL below still says what it actually is.
  structural: 'other',
  pest: 'other',
  security: 'other',
  other: 'other',
};

/**
 * The nearest Bloom priority, for the CHIP COLOUR only.
 *
 * `emergency` maps to `urgent` — Bloom's most severe — and `normal` to
 * `medium`. The words differ deliberately: "emergency" is a claim a tenant
 * makes about their own home and "urgent" is a triage label, and the override
 * keeps the tenant's word on screen.
 */
const BLOOM_PRIORITY: Record<MaintenanceUrgency, BloomPriority> = {
  low: 'low',
  normal: 'medium',
  high: 'high',
  emergency: 'urgent',
};

/** The nearest Bloom stage. See the module header for the two that do not exist. */
const BLOOM_STAGE: Record<MaintenanceStatus, BloomStage> = {
  open: 'reported',
  acknowledged: 'acknowledged',
  scheduled: 'scheduled',
  resolved: 'resolved',
  closed: 'resolved',
  declined: 'acknowledged',
};

/** Every Homiio status, for the label overrides. */
const STATUS_LABEL_KEY: Record<MaintenanceStatus, string> = {
  open: 'maintenance.status.open',
  acknowledged: 'maintenance.status.acknowledged',
  scheduled: 'maintenance.status.scheduled',
  resolved: 'maintenance.status.resolved',
  closed: 'maintenance.status.closed',
  declined: 'maintenance.status.declined',
};

export const maintenanceCategoryKey = (category: MaintenanceCategory): string =>
  `maintenance.category.${category}`;

export const maintenanceUrgencyKey = (urgency: MaintenanceUrgency): string =>
  `maintenance.urgency.${urgency}`;

export const maintenanceStatusKey = (status: MaintenanceStatus): string =>
  STATUS_LABEL_KEY[status];

/**
 * What formatting a card needs.
 *
 * Only `t`. Dates go through `formatLocalized`, which reads the active
 * `date-fns` locale from the i18n instance rather than taking one — so a
 * `locale` field here would be a second source for the same fact, and the one
 * that could disagree.
 */
export interface MaintenanceFormatContext {
  readonly t: TFunction;
}

/**
 * The stage entries Bloom draws its timeline from.
 *
 * Built from the request's own EVENTS when it has them, so the timeline says
 * what actually happened rather than what the current status implies. A list
 * row has no events and falls back to the dates on the request itself, which is
 * why both paths exist rather than one.
 */
function stageEntries(
  request: MaintenanceRequest,
): Partial<Record<BloomStage, MaintenanceStageEntry>> {
  const entries: Partial<Record<BloomStage, MaintenanceStageEntry>> = {
    reported: { date: formatLocalized(new Date(request.createdAt), 'd MMM') },
  };

  for (const event of request.events ?? []) {
    const stage = BLOOM_STAGE[event.to];
    // `reported` is already set from `createdAt`, and a reopen would otherwise
    // overwrite it with the reopen's own date — losing when the problem was
    // first raised, which is the date that matters in a dispute.
    if (stage === 'reported') continue;
    entries[stage] = { date: formatLocalized(new Date(event.createdAt), 'd MMM') };
  }

  if (request.scheduledFor) {
    entries.scheduled = {
      date: formatLocalized(new Date(request.scheduledFor), 'd MMM'),
    };
  }
  if (request.resolvedAt && !entries.resolved) {
    entries.resolved = { date: formatLocalized(new Date(request.resolvedAt), 'd MMM') };
  }

  return entries;
}

/**
 * The props for one card.
 *
 * `actions` and `onPressComments` are left to the caller: a list row and a
 * detail screen offer different things, and baking either in here would make
 * this module decide something it cannot see.
 */
export function maintenanceCardProps(
  request: MaintenanceRequest,
  context: MaintenanceFormatContext,
): Omit<MaintenanceRequestCardProps, 'actions' | 'onPressComments'> {
  const { t } = context;
  return {
    title: request.title,
    category: BLOOM_CATEGORY[request.category],
    // ALWAYS overridden, so a structural repair reads "Structural" rather than
    // the "Other" its icon comes from.
    categoryLabel: t(maintenanceCategoryKey(request.category)),
    description: request.description,
    priority: BLOOM_PRIORITY[request.urgency],
    priorityLabel: t(maintenanceUrgencyKey(request.urgency)),
    stage: BLOOM_STAGE[request.status],
    stages: stageEntries(request),
    stageLabels: {
      // Only the CURRENT stage's word is overridden, because that is the one a
      // reader takes as the request's state. Overriding every stage would
      // relabel the whole timeline with one status.
      [BLOOM_STAGE[request.status]]: t(maintenanceStatusKey(request.status)),
    },
    ...(request.comments ? { commentCount: request.comments.length } : {}),
  };
}
