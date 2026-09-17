import React from 'react';
import { useTranslation } from 'react-i18next';

import { RiLeafLine } from '@oxy.so/bloom/icons';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { useColors } from '@/hooks/useThemeColor';
import { BaseWidget } from './BaseWidget';

const HEADER_ICON_SIZE = 22;

export function EcoCertificationWidget() {
  const { t } = useTranslation();
  const colors = useColors();

  return (
    <BaseWidget
      title={t('home.eco.title')}
      icon={<RiLeafLine width={HEADER_ICON_SIZE} height={HEADER_ICON_SIZE} fill={colors.success} />}
    >
      <BloomText className="text-sm leading-5 text-muted-foreground">{t('home.eco.description')}</BloomText>
    </BaseWidget>
  );
}
