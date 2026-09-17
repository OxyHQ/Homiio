/**
 * YesNoSelector — a boolean picker (tourist apartments, recommendation) on a
 * Bloom `SegmentedControl` (`type="radio"`: picking SETS a value).
 *
 * The answer is tri-state: `null`/`undefined` means "not answered yet", which
 * the control renders with no segment selected (no thumb) until the user picks.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxy.so/bloom/segmented-control';
import { Label } from '@oxy.so/bloom/label';

type YesNo = 'yes' | 'no' | '';

interface YesNoSelectorProps {
  label: string;
  value: boolean | null | undefined;
  onChange: (value: boolean) => void;
}

export const YesNoSelector: React.FC<YesNoSelectorProps> = ({ label, value, onChange }) => {
  const { t } = useTranslation();
  const selected: YesNo = value === true ? 'yes' : value === false ? 'no' : '';
  return (
    <View className="gap-2">
      <Label>{label}</Label>
      <View className="self-start">
        <SegmentedControl<YesNo>
          label={label}
          type="radio"
          value={selected}
          onChange={(next) => {
            if (next) onChange(next === 'yes');
          }}
        >
          <SegmentedControlItem value="yes">
            <SegmentedControlItemText>{t('common.yes')}</SegmentedControlItemText>
          </SegmentedControlItem>
          <SegmentedControlItem value="no">
            <SegmentedControlItemText>{t('common.no')}</SegmentedControlItemText>
          </SegmentedControlItem>
        </SegmentedControl>
      </View>
    </View>
  );
};

export default YesNoSelector;
