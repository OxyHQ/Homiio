/**
 * Legal and housing resources for the case's jurisdiction.
 *
 * Three properties this component must keep, because each one is the difference
 * between help and harm:
 *
 * **The disclaimer comes from the SERVER and is always rendered.** A new
 * consumer gets it without knowing it exists, and it cannot drift between web
 * and native.
 *
 * **Every entry shows WHO published it and WHEN it was checked.** A link with no
 * source is an anonymous recommendation, and one with no date is a claim about
 * the present made at an unknown time.
 *
 * **An empty list is a real answer, rendered as one.** "Nothing verified for
 * your area yet" is true; showing a neighbouring country's tenant union to
 * somebody about to lose their home is not.
 */

import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import type { JurisdictionResourceWithId } from '@homiio/shared-types';
import { formatEvictionShortDate } from './evictionUtils';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

export interface EvictionResourcesProps {
  readonly resources: readonly JurisdictionResourceWithId[];
  readonly disclaimer?: string;
  readonly locale: string;
  readonly isLoading?: boolean;
  readonly isError?: boolean;
}

/**
 * One resource row.
 *
 * Its own component so the pressed state can live in `useState`: hooks cannot
 * run inside `.map()`, and NativeWind's css-interop swallows the function form
 * of `style` entirely, so a static array plus `onPressIn`/`onPressOut` is the
 * only shape that renders at all.
 */
const ResourceRow: React.FC<{
  readonly resource: JurisdictionResourceWithId;
  readonly locale: string;
}> = ({ resource, locale }) => {
  const { t } = useTranslation();
  const [pressed, setPressed] = useState(false);

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t('evictions.resources.openLabel', { title: resource.title })}
      accessibilityHint={resource.source}
      onPress={() => {
        void Linking.openURL(resource.url);
      }}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowBody}>
        <BloomText style={styles.title}>{resource.title}</BloomText>
        <BloomText style={styles.meta}>
          {t('evictions.resources.meta', {
            source: resource.source,
            verified: formatEvictionShortDate(resource.verifiedAt, locale),
          })}
        </BloomText>
        <BloomText style={styles.kind}>
          {t(`evictions.resources.type.${resource.resourceType}`)}
        </BloomText>
      </View>
      <Ionicons name="open-outline" size={16} color={colors.textSecondary} />
    </Pressable>
  );
};

export const EvictionResources: React.FC<EvictionResourcesProps> = ({
  resources,
  disclaimer,
  locale,
  isLoading,
  isError,
}) => {
  const { t } = useTranslation();

  if (isLoading) {
    return <BloomText style={styles.state}>{t('evictions.resources.loading')}</BloomText>;
  }
  if (isError) {
    return <BloomText style={styles.state}>{t('evictions.resources.error')}</BloomText>;
  }

  return (
    <View style={styles.root}>
      {resources.length === 0 ? (
        <BloomText style={styles.state}>{t('evictions.resources.empty')}</BloomText>
      ) : (
        resources.map((resource) => (
          <ResourceRow key={resource.id} resource={resource} locale={locale} />
        ))
      )}
      {/* Rendered even when the list is empty: the reason there is nothing here
          is as much a part of the disclaimer as the links would be. */}
      <BloomText style={styles.disclaimer}>
        {disclaimer ?? t('evictions.resources.fallbackDisclaimer')}
      </BloomText>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  rowPressed: {
    backgroundColor: colors.mutedSubtle,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  meta: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  kind: {
    fontSize: 12,
    color: colors.muted,
  },
  state: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  disclaimer: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
});

export default EvictionResources;
