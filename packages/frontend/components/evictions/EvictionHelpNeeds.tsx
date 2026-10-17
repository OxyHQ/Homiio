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

import type React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chip } from '@oxy.so/bloom/chip';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import type { EvictionHelpNeed } from '@homiio/shared-types';

export interface EvictionHelpNeedsProps {
  readonly needs: readonly EvictionHelpNeed[];
}

export const EvictionHelpNeeds: React.FC<EvictionHelpNeedsProps> = ({ needs }) => {
  const { t } = useTranslation();

  if (needs.length === 0) {
    return (
      <BloomText className="text-sm text-muted-foreground">{t('evictions.help.empty')}</BloomText>
    );
  }

  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap gap-1">
        {needs.map((need) => (
          <Chip key={need.type} variant="outlined" color="default">
            {t(`evictions.help.need.${need.type}`)}
          </Chip>
        ))}
      </View>
      {needs
        .filter((need) => Boolean(need.note))
        .map((need) => (
          <BloomText
            key={`${need.type}-note`}
            className="text-[13px] leading-[18px] text-muted-foreground"
          >
            {t('evictions.help.noteLine', {
              need: t(`evictions.help.need.${need.type}`),
              note: need.note,
            })}
          </BloomText>
        ))}
    </View>
  );
};
