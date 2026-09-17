/**
 * The case timeline: what changed, when, and who said so.
 *
 * Every entry is immutable server-side (a database trigger refuses an `UPDATE`),
 * so this list is an audit rather than a feed. Two consequences for the render:
 *
 *  - **The entries are shown in the order they happened**, oldest first, keyed
 *    on `position` rather than on `createdAt`. Two entries can share a
 *    millisecond; `position` is unique per case by construction.
 *  - **A `system` actor is rendered as "Homiio", never as a person.** A report
 *    threshold firing must not become "these people reported this", which is
 *    what would turn the timeline into a retaliation channel.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  RiAlertLine,
  RiCalendarLine,
  RiChat3Line,
  RiCloseCircleLine,
  RiEditLine,
  RiEyeOffLine,
  RiFileTextLine,
  RiHandHeartLine,
  RiInformationLine,
  RiMapPinLine,
  RiMegaphoneLine,
  RiShieldCheckLine,
  RiTimeLine,
} from '@oxy.so/bloom/icons';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { EvictionTimelineEventType, type EvictionTimelineEvent } from '@homiio/shared-types';
import { formatEvictionDateTime } from './evictionUtils';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

/** One Remix glyph per event type. Exhaustive, so a new type fails to compile here. */
const ICON_BY_EVENT: Readonly<Record<EvictionTimelineEventType, typeof RiMegaphoneLine>> = {
  [EvictionTimelineEventType.CASE_CREATED]: RiMegaphoneLine,
  [EvictionTimelineEventType.DATE_CHANGED]: RiCalendarLine,
  [EvictionTimelineEventType.LOCATION_PRECISION_CHANGED]: RiMapPinLine,
  [EvictionTimelineEventType.INSTRUCTIONS_UPDATED]: RiInformationLine,
  [EvictionTimelineEventType.POSTPONED]: RiTimeLine,
  [EvictionTimelineEventType.STOPPED]: RiHandHeartLine,
  [EvictionTimelineEventType.EXECUTED]: RiAlertLine,
  [EvictionTimelineEventType.CANCELLED]: RiCloseCircleLine,
  [EvictionTimelineEventType.LEGAL_RESOURCE_ADDED]: RiFileTextLine,
  [EvictionTimelineEventType.ORGANIZATION_VERIFIED]: RiShieldCheckLine,
  [EvictionTimelineEventType.CORRECTION_PUBLISHED]: RiEditLine,
  [EvictionTimelineEventType.PRECAUTIONARY_HOLD_APPLIED]: RiEyeOffLine,
  [EvictionTimelineEventType.NOTE]: RiChat3Line,
};

/** One entry; its own component so the icon lookup reads as a component. */
const TimelineEntry: React.FC<{ event: EvictionTimelineEvent; locale: string }> = ({
  event,
  locale,
}) => {
  const { t } = useTranslation();
  const Icon = ICON_BY_EVENT[event.eventType];
  return (
    <View style={styles.entry} accessibilityRole="text">
      <View style={styles.iconWrap}>
        <Icon size="sm" fill={colors.textSecondary} />
      </View>
      <View style={styles.body}>
        <BloomText style={styles.kind}>
          {t(`evictions.timeline.event.${event.eventType}`)}
        </BloomText>
        <BloomText style={styles.message}>{event.message}</BloomText>
        <BloomText style={styles.meta}>
          {t('evictions.timeline.byline', {
            actor:
              event.actor.kind === 'system'
                ? t('evictions.timeline.systemActor')
                : t('evictions.timeline.organizerActor'),
            when: formatEvictionDateTime(event.createdAt, locale),
          })}
        </BloomText>
      </View>
    </View>
  );
};

export interface EvictionTimelineProps {
  readonly events: readonly EvictionTimelineEvent[];
  readonly locale: string;
}

export const EvictionTimeline: React.FC<EvictionTimelineProps> = ({ events, locale }) => {
  const { t } = useTranslation();

  if (events.length === 0) {
    return <BloomText style={styles.empty}>{t('evictions.timeline.empty')}</BloomText>;
  }

  return (
    <View style={styles.root} accessibilityRole="list">
      {[...events]
        .sort((a, b) => a.position - b.position)
        .map((event) => (
          <TimelineEntry key={event.id} event={event} locale={locale} />
        ))}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  entry: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mutedSubtle,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  kind: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  message: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  meta: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  empty: {
    fontSize: 14,
    color: colors.textSecondary,
  },
});

export default EvictionTimeline;
