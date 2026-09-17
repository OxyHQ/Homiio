import React from 'react';
import * as Linking from 'expo-linking';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { RiStarFill } from '@oxy.so/bloom/icons';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { useColors } from '@/hooks/useThemeColor';
import { BaseWidget } from './BaseWidget';

const HEADER_ICON_SIZE = 22;

export function HorizonInitiativeWidget() {
  const { t } = useTranslation();
  const colors = useColors();

  return (
    <BaseWidget
      title={t('horizon.title')}
      icon={<RiStarFill width={HEADER_ICON_SIZE} height={HEADER_ICON_SIZE} fill={colors.ratingStar} />}
    >
      <BloomText className="text-sm leading-5 text-muted-foreground">{t('horizon.description')}</BloomText>
      {/* A real Bloom variant owns both the fill and the label colour. The old
          local `style` + `textStyle` override painted a pale fill under Bloom's
          own label colour, so on `/` the button rendered with no visible text. */}
      <Button
        variant="secondary"
        size="medium"
        onPress={() => {
          Linking.openURL('https://oxy.so/horizon').catch(() => undefined);
        }}
        accessibilityLabel={t('home.horizon.learnMore')}
      >
        {t('home.horizon.learnMore')}
      </Button>
    </BaseWidget>
  );
}
