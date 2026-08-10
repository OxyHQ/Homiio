/**
 * "Cómo ayudar" — what this case needs, as structured options rather than prose.
 *
 * Structured because a paragraph saying "we need people, and someone who speaks
 * Urdu, and a van" is not something a reader can scan under pressure, and not
 * something the board can filter on. Each need is a chip a person can match
 * themselves against.
 *
 * **Donations are deliberately absent.** #358 puts money behind "only if a safe
 * flow is approved" and names handling it without a financial and anti-fraud
 * review in its own out-of-scope list. There is no member for it in
 * `EvictionHelpNeedType`, so there is nothing to render and nothing to forget to
 * hide.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chip } from '@oxyhq/bloom/chip';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import type { EvictionHelpNeed } from '@homiio/shared-types';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

export interface EvictionHelpNeedsProps {
  readonly needs: readonly EvictionHelpNeed[];
}

export const EvictionHelpNeeds: React.FC<EvictionHelpNeedsProps> = ({ needs }) => {
  const { t } = useTranslation();

  if (needs.length === 0) {
    return <BloomText style={styles.empty}>{t('evictions.help.empty')}</BloomText>;
  }

  return (
    <View style={styles.root}>
      <View style={styles.chips}>
        {needs.map((need) => (
          <Chip key={need.type} variant="outlined" color="default">
            {t(`evictions.help.need.${need.type}`)}
          </Chip>
        ))}
      </View>
      {needs
        .filter((need) => Boolean(need.note))
        .map((need) => (
          <BloomText key={`${need.type}-note`} style={styles.note}>
            {t('evictions.help.noteLine', {
              need: t(`evictions.help.need.${need.type}`),
              note: need.note,
            })}
          </BloomText>
        ))}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  note: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  empty: {
    fontSize: 14,
    color: colors.textSecondary,
  },
});

export default EvictionHelpNeeds;
