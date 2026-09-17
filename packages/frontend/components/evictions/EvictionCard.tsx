/**
 * EvictionCard — one case on the solidarity board: Bloom's `EvictionReportCard`
 * (status, the day as the heading, time and "in 3 days", the published area,
 * turnout) made a single pressable that opens the case.
 *
 * `evictionReportCardProps` is the one mapping from an `EvictionCase` to the
 * card, shared with the detail screen so the board and the case never describe
 * the same eviction differently.
 *
 * What is deliberately NOT passed, although the card has a slot for it:
 *
 *  - `household` — the affected household's composition is a field Homiio does
 *    not have (ADR 0003 §7.2), so there is nothing to draw and nothing to invent.
 *  - `verified` — Bloom's mark means "checked by the community". Homiio's only
 *    verification is of the ORGANISATION, by Homiio, against a public source; the
 *    detail screen says exactly that, and borrowing the community label would
 *    claim a check nobody made.
 *  - the attend / share / contact actions — the board opens the case, where the
 *    RSVP carries its loading state and the contact its unlock rules. Buttons
 *    inside a pressable card would also nest one control in another.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { EvictionReportCard, type EvictionReportCardProps } from '@oxy.so/bloom/eviction';
import type { EvictionCase } from '@homiio/shared-types';

import { formatRelativeTime } from '@/utils/dateLocale';
import {
  EVICTION_STATUS_META,
  formatEvictionArea,
  formatEvictionDay,
  formatEvictionTime,
} from './evictionUtils';

type ReportCardData = Pick<
  EvictionReportCardProps,
  'date' | 'time' | 'relativeLabel' | 'status' | 'statusLabel' | 'area' | 'attendeesLabel'
>;

/** The card's data for a case. Every string is pre-formatted: the card never reads the clock. */
export function evictionReportCardProps(
  eviction: EvictionCase,
  locale: string,
  t: TFunction,
): ReportCardData {
  const meta = EVICTION_STATUS_META[eviction.status];
  const scheduled = new Date(eviction.scheduledAt);
  return {
    date: formatEvictionDay(eviction.scheduledAt, locale),
    time: formatEvictionTime(eviction.scheduledAt, locale) || undefined,
    relativeLabel: Number.isNaN(scheduled.getTime()) ? undefined : formatRelativeTime(scheduled),
    status: meta.status,
    statusLabel: t(meta.i18nKey),
    area: formatEvictionArea(eviction.location),
    attendeesLabel: t('evictions.attendeesCount', { count: eviction.attendeeCount }),
  };
}

interface EvictionCardProps {
  eviction: EvictionCase;
  locale: string;
  onPress: () => void;
}

export const EvictionCard: React.FC<EvictionCardProps> = ({ eviction, locale, onPress }) => {
  const { t } = useTranslation();
  const [pressed, setPressed] = useState(false);
  const data = evictionReportCardProps(eviction, locale, t);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={[eviction.title, data.date, data.time, data.area, data.statusLabel]
        .filter(Boolean)
        .join(', ')}
      style={[styles.press, pressed && styles.pressed]}
    >
      <EvictionReportCard
        {...data}
        // The organiser's headline, under the date: on a board sorted by date,
        // WHEN and WHERE are what a reader scans for.
        description={eviction.title}
        numberOfLines={2}
        headingLevel={3}
      />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  press: {
    borderRadius: 16,
  },
  pressed: {
    opacity: 0.85,
  },
});

export default EvictionCard;
