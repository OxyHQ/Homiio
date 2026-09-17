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
 *
 * The links are a `filled` Bloom `SettingsListGroup`: the block sits inside the
 * detail screen's card, which already paints the `card` colour.
 */

import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Loading } from '@oxy.so/bloom/loading';
import { RiFileTextLine } from '@oxy.so/bloom/icons';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import type { JurisdictionResourceWithId } from '@homiio/shared-types';
import { SettingsRowIcon } from '@/components/profile/SettingsRowIcon';
import { formatEvictionShortDate } from './evictionUtils';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

export interface EvictionResourcesProps {
  readonly resources: readonly JurisdictionResourceWithId[];
  readonly disclaimer?: string;
  readonly locale: string;
  readonly isLoading?: boolean;
  readonly isError?: boolean;
}

export const EvictionResources: React.FC<EvictionResourcesProps> = ({
  resources,
  disclaimer,
  locale,
  isLoading,
  isError,
}) => {
  const { t } = useTranslation();

  if (isLoading) {
    return <Loading variant="inline" size="small" text={t('evictions.resources.loading')} />;
  }
  if (isError) {
    return <BloomText style={styles.state}>{t('evictions.resources.error')}</BloomText>;
  }

  return (
    <View style={styles.root}>
      {resources.length === 0 ? (
        <BloomText style={styles.state}>{t('evictions.resources.empty')}</BloomText>
      ) : (
        <SettingsListGroup variant="filled">
          {resources.map((resource) => (
            <SettingsListItem
              key={resource.id}
              icon={<SettingsRowIcon icon={RiFileTextLine} />}
              title={resource.title}
              description={[
                t('evictions.resources.meta', {
                  source: resource.source,
                  verified: formatEvictionShortDate(resource.verifiedAt, locale),
                }),
                t(`evictions.resources.type.${resource.resourceType}`),
              ].join('\n')}
              accessibilityRole="link"
              accessibilityLabel={t('evictions.resources.openLabel', { title: resource.title })}
              accessibilityHint={resource.source}
              onPress={() => {
                void Linking.openURL(resource.url);
              }}
            />
          ))}
        </SettingsListGroup>
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
  state: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  disclaimer: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
});

export default EvictionResources;
