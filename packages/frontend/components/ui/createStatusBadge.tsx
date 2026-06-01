/**
 * createStatusBadge — a factory that turns a status→badge map into a typed
 * Bloom `Badge` component.
 *
 * Several list cards (applications, reservations, exchange requests) each had
 * their own near-identical "status enum → { label, color } → subtle small
 * Badge" component. They drifted in lockstep. This factory owns that one
 * rendering rule so each domain only declares its map.
 *
 * Each entry carries a Bloom `color` and a `label`. When an entry also supplies
 * an `i18nKey`, the badge renders `t(i18nKey, label)` (label as the fallback);
 * otherwise it renders the literal `label`. The returned component always calls
 * `useTranslation`, so an i18n map and a static map share one code path without
 * the caller opting in.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, type BadgeColor } from '@oxyhq/bloom/badge';

/** One status's badge appearance: a Bloom color, a label, and an optional i18n key. */
export interface StatusBadgeEntry {
  /** Bloom semantic color for the badge. */
  color: BadgeColor;
  /** Display label, or the i18n fallback when `i18nKey` is set. */
  label: string;
  /** When present, the label is resolved as `t(i18nKey, label)`. */
  i18nKey?: string;
}

/** Props of a component produced by {@link createStatusBadge}. */
export interface StatusBadgeProps<T extends string> {
  status: T;
}

/**
 * Build a status-badge component from a `status → { color, label, i18nKey? }`
 * map. The map is exhaustive over `T` (a string-literal/enum union), so adding a
 * status without a badge entry is a compile error.
 */
export function createStatusBadge<T extends string>(
  map: Record<T, StatusBadgeEntry>,
): React.FC<StatusBadgeProps<T>> {
  const StatusBadge: React.FC<StatusBadgeProps<T>> = ({ status }) => {
    const { t } = useTranslation();
    const entry = map[status];
    const content = entry.i18nKey ? t(entry.i18nKey, entry.label) : entry.label;
    return <Badge content={content} variant="subtle" color={entry.color} size="small" />;
  };
  return StatusBadge;
}
