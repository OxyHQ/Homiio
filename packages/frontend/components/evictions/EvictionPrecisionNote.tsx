/**
 * The sentence that explains what the pin on the map actually means.
 *
 * ## Why this component exists at all
 *
 * A coordinate looks exact to every consumer. The board publishes a CENTRE and a
 * RADIUS — the true point is somewhere inside that disc, uniformly — and a map
 * that draws a pin without saying so is telling the reader something false in
 * the most confident possible way. #358 asks for an "explicación de precisión
 * aproximada"; this is it, and it states the radius rather than saying
 * "approximate", because a supporter needs to know whether to look for a street
 * or a neighbourhood.
 *
 * Three states, and they are different facts:
 *
 *  - **held** — somebody reported the location as too precise or as exposing
 *    personal data, so no point is published at all until the organiser answers.
 *  - **archived** — the case is old; what remains is the neighbourhood.
 *  - **published** — a centre and a radius.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import {
  formatDistance,
  type EvictionLocationPublic,
  type EvictionModerationState,
} from '@homiio/shared-types';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

export interface EvictionPrecisionNoteProps {
  readonly location: EvictionLocationPublic;
  readonly moderation: EvictionModerationState;
  readonly locale: string;
}

export const EvictionPrecisionNote: React.FC<EvictionPrecisionNoteProps> = ({
  location,
  moderation,
  locale,
}) => {
  const { t } = useTranslation();

  const message = (() => {
    if (moderation.precautionaryHold) return t('evictions.precision.held');
    if (!location.approximateCoordinates || !location.radiusMeters) {
      return t('evictions.precision.noPoint');
    }
    return t('evictions.precision.radius', {
      distance: formatDistance(location.radiusMeters, locale),
    });
  })();

  return (
    <View style={styles.root} accessibilityRole="text">
      <Ionicons name="shield-outline" size={16} color={colors.textSecondary} />
      <BloomText style={styles.text}>{message}</BloomText>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'flex-start',
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.mutedSubtle,
  },
  text: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});

export default EvictionPrecisionNote;
