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

import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Item } from '@oxy.so/bloom/item';
import { Loading } from '@oxy.so/bloom/loading';
import { RiExternalLinkLine, RiFileTextLine } from '@oxy.so/bloom/icons';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import type { JurisdictionResourceWithId } from '@homiio/shared-types';
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
        resources.map((resource) => (
          <Item
            key={resource.id}
            role="listitem"
            accessibilityRole="link"
            accessibilityLabel={t('evictions.resources.openLabel', { title: resource.title })}
            accessibilityHint={resource.source}
            leading={<RiFileTextLine size="md" fill={colors.textSecondary} />}
            trailing={<RiExternalLinkLine size="sm" fill={colors.textSecondary} />}
            onPress={() => {
              void Linking.openURL(resource.url);
            }}
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
          </Item>
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
    gap: spacing.xs,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
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
    marginTop: spacing.xs,
  },
});

export default EvictionResources;
