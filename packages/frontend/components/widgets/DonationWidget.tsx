import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { Button } from '@oxy.so/bloom/button';
import { RiGroupLine, RiHeartFill, RiHomeLine, RiShieldCheckLine } from '@oxy.so/bloom/icons';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { useColors } from '@/hooks/useThemeColor';
import { BaseWidget } from './BaseWidget';

const HEADER_ICON_SIZE = 20;
const IMPACT_ICON_SIZE = 16;

/** The three impact areas, in display order: icon + i18n title key. */
const IMPACT_AREAS = [
  { key: 'development', Icon: RiHomeLine },
  { key: 'safety', Icon: RiShieldCheckLine },
  { key: 'community', Icon: RiGroupLine },
] as const;

export function DonationWidget() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useColors();

  return (
    <BaseWidget
      title={t('donations.widget.title')}
      icon={<RiHeartFill width={HEADER_ICON_SIZE} height={HEADER_ICON_SIZE} fill={colors.primary} />}
    >
      <View className="gap-4">
        <BloomText className="text-sm leading-5 text-muted-foreground">
          {t('donations.widget.description')}
        </BloomText>

        <View className="gap-2">
          {IMPACT_AREAS.map(({ key, Icon }) => (
            <View key={key} className="flex-row items-center gap-2">
              <Icon width={IMPACT_ICON_SIZE} height={IMPACT_ICON_SIZE} fill={colors.primary} />
              <BloomText className="flex-1 text-[13px] text-muted-foreground">
                {t(`donations.page.impact.areas.${key}.title`)}
              </BloomText>
            </View>
          ))}
        </View>

        <Button leadingIcon={RiHeartFill} onPress={() => router.push('/donate')} variant="primary">
          {t('donations.widget.button')}
        </Button>
      </View>
    </BaseWidget>
  );
}
