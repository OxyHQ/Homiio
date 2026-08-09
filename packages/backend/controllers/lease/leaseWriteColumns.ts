/**
 * Turning a lease request body into COLUMNS.
 *
 * `CREATABLE_LEASE_FIELDS` / `EDITABLE_LEASE_FIELDS` name the nested paths a
 * client may set (`leaseTerms`, `rentDetails`, `rules`, …); `db/schema/leases.ts`
 * stores them flattened (`lease_terms_start_date`, `rules_pets_allowed`, …). This
 * module is the ONE place that mapping lives.
 *
 * ## Why this is not `Object.assign(lease, updates)` any more, and must not be
 *
 * Mongoose let the controller assign a whole nested object onto the document and
 * sort the paths out itself. Doing the equivalent here — spreading a picked
 * subtree into `.set()` — would send drizzle keys that are not columns, and
 * drizzle IGNORES an unknown key rather than refusing it. The write would
 * succeed, report success, and silently store nothing.
 *
 * So every field is named explicitly below. The cost is a long function; the
 * benefit is that a field nobody mapped cannot look like a field that was saved.
 * `pickFields` still runs first, so this only ever sees the allow-listed subtree.
 */

import {
  LEASE_CO_TENANT_ROLES,
  LEASE_CO_TENANT_STATUSES,
  LEASE_PET_TYPES,
  LEASE_RENEWAL_OPTIONS,
  LEASE_UTILITIES,
} from '../../db/schema/leases';
import { PAYMENT_CURRENCIES } from '@homiio/shared-types';
import type { leaseCoTenants, leaseSharedUtilityCosts, leases } from '../../db/schema';

type Loose = Record<string, unknown>;

/** A nested object off the request body, or an empty bag. */
function subtree(value: unknown): Loose {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : {};
}

function asDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * A string array filtered to a declared vocabulary.
 *
 * Filtered rather than rejected, matching what Mongoose did with an `enum` on an
 * array element under `runValidators: false` — except that here an undeclared
 * value would hit a `<@` CHECK and 500. Dropping it keeps the request working
 * and keeps the constraint true.
 */
function asVocabularyArray(value: unknown, vocabulary: readonly string[]): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === 'string' && vocabulary.includes(entry));
}

/** Free-text array (pet restrictions), with no vocabulary to check against. */
function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/** Assign `value` under `key` only when it is present, so a default survives. */
function put<T>(target: Record<string, unknown>, key: string, value: T | undefined): void {
  if (value !== undefined) target[key] = value;
}

export type LeaseColumnPatch = Partial<
  Omit<typeof leases.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>
>;

/**
 * Map an allow-listed body subtree onto lease columns.
 *
 * Only keys actually PRESENT in the body are emitted, so a create takes the
 * column defaults and an update touches nothing it was not asked to.
 */
export function toLeaseColumns(picked: Loose): LeaseColumnPatch {
  const columns: Record<string, unknown> = {};

  const terms = subtree(picked.leaseTerms);
  put(columns, 'leaseTermsStartDate', asDate(terms.startDate));
  put(columns, 'leaseTermsEndDate', asDate(terms.endDate));
  const renewalOptions = asString(terms.renewalOptions);
  if (renewalOptions !== undefined && (LEASE_RENEWAL_OPTIONS as readonly string[]).includes(renewalOptions)) {
    columns.leaseTermsRenewalOptions = renewalOptions;
  }
  put(columns, 'leaseTermsRenewalNoticeRequired', asNumber(terms.renewalNoticeRequired));
  put(columns, 'leaseTermsTerminationNoticeRequired', asNumber(terms.terminationNoticeRequired));

  const rent = subtree(picked.rentDetails);
  put(columns, 'rentDetailsMonthlyRent', asNumber(rent.monthlyRent));
  const currency = asString(rent.currency);
  if (currency !== undefined && (PAYMENT_CURRENCIES as readonly string[]).includes(currency)) {
    columns.rentDetailsCurrency = currency;
  }
  put(columns, 'rentDetailsDueDate', asNumber(rent.dueDate));
  put(columns, 'rentDetailsLateFeeAmount', asNumber(rent.lateFeeAmount));
  put(columns, 'rentDetailsLateFeeGracePeriod', asNumber(rent.lateFeeGracePeriod));
  put(columns, 'rentDetailsSecurityDeposit', asNumber(rent.securityDeposit));
  put(columns, 'rentDetailsPetDeposit', asNumber(rent.petDeposit));

  const utilities = subtree(picked.utilities);
  put(columns, 'utilitiesIncluded', asVocabularyArray(utilities.included, LEASE_UTILITIES));
  put(
    columns,
    'utilitiesTenantResponsible',
    asVocabularyArray(utilities.tenantResponsible, LEASE_UTILITIES),
  );

  const rules = subtree(picked.rules);
  const pets = subtree(rules.pets);
  put(columns, 'rulesPetsAllowed', asBoolean(pets.allowed));
  put(columns, 'rulesPetsTypes', asVocabularyArray(pets.types, LEASE_PET_TYPES));
  put(columns, 'rulesPetsMaxNumber', asNumber(pets.maxNumber));
  put(columns, 'rulesPetsRestrictions', asStringArray(pets.restrictions));
  put(columns, 'rulesSmoking', asBoolean(rules.smoking));
  const guests = subtree(rules.guests);
  put(columns, 'rulesGuestsOvernightAllowed', asBoolean(guests.overnightAllowed));
  put(columns, 'rulesGuestsOvernightMaxConsecutiveDays', asNumber(guests.maxConsecutiveDays));
  put(columns, 'rulesGuestsOvernightMaxDaysPerMonth', asNumber(guests.maxDaysPerMonth));
  put(columns, 'rulesGuestsParties', asBoolean(guests.parties));
  put(columns, 'rulesSubletting', asBoolean(rules.subletting));
  put(columns, 'rulesAlterations', asBoolean(rules.alterations));

  put(columns, 'roomId', asString(picked.roomId));
  put(columns, 'notes', asString(picked.notes));

  return columns as LeaseColumnPatch;
}

export type CoTenantInsert = Omit<typeof leaseCoTenants.$inferInsert, 'id' | 'leaseId'>;

/**
 * The `coTenants` array, or `undefined` when the body did not carry one.
 *
 * `undefined` and `[]` mean different things to `updateLease`: the first leaves
 * the existing co-tenants alone, the second removes them all. Collapsing the two
 * would make it impossible to edit any other field without wiping the roster.
 */
export function toCoTenantRows(picked: Loose): CoTenantInsert[] | undefined {
  if (!Array.isArray(picked.coTenants)) return undefined;
  return picked.coTenants.flatMap((entry): CoTenantInsert[] => {
    const source = subtree(entry);
    const oxyUserId = asString(source.oxyUserId);
    // A co-tenant with no account is not a co-tenant; `oxy_user_id` is NOT NULL
    // and the row would be a `23502` naming a column the client never sent.
    if (!oxyUserId) return [];
    const row: CoTenantInsert = { oxyUserId };
    const role = asString(source.role);
    if (role !== undefined && (LEASE_CO_TENANT_ROLES as readonly string[]).includes(role)) {
      Object.assign(row, { role });
    }
    const status = asString(source.status);
    if (status !== undefined && (LEASE_CO_TENANT_STATUSES as readonly string[]).includes(status)) {
      Object.assign(row, { status });
    }
    const signedDate = asDate(source.signedDate);
    if (signedDate !== undefined) Object.assign(row, { signedDate });
    return [row];
  });
}

export type SharedUtilityCostInsert = Omit<
  typeof leaseSharedUtilityCosts.$inferInsert,
  'id' | 'leaseId'
>;

/** `utilities.sharedCosts`, or `undefined` when the body did not carry one. */
export function toSharedUtilityCostRows(picked: Loose): SharedUtilityCostInsert[] | undefined {
  const utilities = subtree(picked.utilities);
  if (!Array.isArray(utilities.sharedCosts)) return undefined;
  return utilities.sharedCosts.flatMap((entry): SharedUtilityCostInsert[] => {
    const source = subtree(entry);
    const row: SharedUtilityCostInsert = {};
    const utility = asString(source.utility);
    if (utility !== undefined && (LEASE_UTILITIES as readonly string[]).includes(utility)) {
      Object.assign(row, { utility });
    }
    const splitPercentage = asNumber(source.splitPercentage);
    if (splitPercentage !== undefined) Object.assign(row, { splitPercentage });
    // Both columns are nullable, so an entry that mapped to nothing is a row of
    // NULLs — noise rather than data. Dropped.
    return Object.keys(row).length > 0 ? [row] : [];
  });
}
