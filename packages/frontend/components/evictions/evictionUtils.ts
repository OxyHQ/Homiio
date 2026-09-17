/**
 * Shared, pure helpers for the eviction solidarity board — status → badge
 * metadata, the day/month/time date block, short marker labels, and the
 * tel:/mailto:/https://wa.me/https://t.me contact link builders. No JSX, no
 * hooks, so both the board card and the detail screen import from here.
 */
import { EvictionCaseStatus, type EvictionContactInfo } from '@homiio/shared-types';
import type { ChipHue } from '@oxy.so/bloom/chip';

/** Bloom Chip data hue + i18n label key per lifecycle status. */
export interface EvictionStatusMeta {
  hue: ChipHue;
  i18nKey: string;
}

export const EVICTION_STATUS_META: Record<EvictionCaseStatus, EvictionStatusMeta> = {
  [EvictionCaseStatus.UPCOMING]: { hue: 'yellow', i18nKey: 'evictions.status.upcoming' },
  [EvictionCaseStatus.STOPPED]: { hue: 'lime', i18nKey: 'evictions.status.stopped' },
  [EvictionCaseStatus.POSTPONED]: { hue: 'cyan', i18nKey: 'evictions.status.postponed' },
  [EvictionCaseStatus.EXECUTED]: { hue: 'rose', i18nKey: 'evictions.status.executed' },
  [EvictionCaseStatus.CANCELLED]: { hue: 'neutral', i18nKey: 'evictions.status.cancelled' },
};

/** The day/month/time pieces rendered by the calendar-style date block. */
export interface EvictionDateParts {
  day: string;
  month: string;
  time: string;
  weekday: string;
}

const safeDate = (iso: string): Date | null => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Split an ISO date into the calendar block's day / month / time / weekday. */
export function formatEvictionDateParts(iso: string, locale: string): EvictionDateParts {
  const date = safeDate(iso);
  if (!date) return { day: '--', month: '', time: '', weekday: '' };
  return {
    day: new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(date),
    month: new Intl.DateTimeFormat(locale, { month: 'short' }).format(date).replace('.', ''),
    time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date),
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date),
  };
}

/** Full, human-readable date + time (detail "when" line). */
export function formatEvictionFullDate(iso: string, locale: string): string {
  const date = safeDate(iso);
  if (!date) return '';
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * Combine a picked day (a local-midnight `Date` from Bloom's `DatePicker`) and
 * an optional typed `HH:mm` into the ISO string the API takes. `undefined` when
 * no day is picked or the time does not parse — the caller decides whether that
 * is "no change" or an error.
 */
export function combineDateAndTime(day: Date | null, time: string): string | undefined {
  if (!day || Number.isNaN(day.getTime())) return undefined;
  const trimmed = time.trim();
  const match = trimmed ? TIME_PATTERN.exec(trimmed) : null;
  if (trimmed && !match) return undefined;
  const combined = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    match ? Number(match[1]) : 0,
    match ? Number(match[2]) : 0,
  );
  return combined.toISOString();
}

/** Split an ISO date into the local day (for `DatePicker`) and `HH:mm` text. */
export function splitDateAndTime(iso: string): { day: Date | null; time: string } {
  const parsed = safeDate(iso);
  if (!parsed) return { day: null, time: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    day: new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()),
    time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`,
  };
}

/**
 * A timeline entry's timestamp: the date AND the time.
 *
 * The timeline is an audit, and a bare date cannot distinguish two entries on
 * the day everything happened — which is the day this page matters most.
 */
export function formatEvictionDateTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Compact label for a map marker (e.g. "15 jul"). */
export function formatEvictionShortDate(iso: string, locale: string): string {
  const date = safeDate(iso);
  if (!date) return '';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
    .format(date)
    .replace('.', '');
}

/** A single tappable contact action derived from the case's `contactInfo`. */
export interface EvictionContactAction {
  kind: 'phone' | 'whatsapp' | 'email' | 'telegram';
  /** Display value (the raw handle / number / address). */
  value: string;
  /** The `Linking.openURL` target. */
  url: string;
}

const buildWhatsAppUrl = (value: string): string =>
  /wa\.me\/|api\.whatsapp\.com/i.test(value) ? value : `https://wa.me/${value.replace(/\D/g, '')}`;

const buildTelegramUrl = (value: string): string => {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://t.me/${trimmed.replace(/^@/, '')}`;
};

/**
 * Build the ordered list of tappable contact actions from a case's contact
 * info. Only fields the reporter actually provided appear — contacts are never
 * invented. `instructions` is rendered separately by the caller.
 */
export function buildEvictionContactActions(
  contact: EvictionContactInfo | undefined,
): EvictionContactAction[] {
  if (!contact) return [];
  const actions: EvictionContactAction[] = [];
  if (contact.phone?.trim()) {
    actions.push({
      kind: 'phone',
      value: contact.phone.trim(),
      url: `tel:${contact.phone.trim()}`,
    });
  }
  if (contact.whatsapp?.trim()) {
    actions.push({
      kind: 'whatsapp',
      value: contact.whatsapp.trim(),
      url: buildWhatsAppUrl(contact.whatsapp.trim()),
    });
  }
  if (contact.telegram?.trim()) {
    actions.push({
      kind: 'telegram',
      value: contact.telegram.trim(),
      url: buildTelegramUrl(contact.telegram.trim()),
    });
  }
  if (contact.email?.trim()) {
    actions.push({
      kind: 'email',
      value: contact.email.trim(),
      url: `mailto:${contact.email.trim()}`,
    });
  }
  return actions;
}
