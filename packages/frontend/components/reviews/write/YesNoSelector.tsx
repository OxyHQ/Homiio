/**
 * YesNoSelector — a two-chip boolean picker (tourist apartments, recommendation).
 * The chip is its own component with static style arrays + press/hover state
 * (AGENTS.md §NativeWind Pressable).
 */
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { hairline, radius, spacing } from '@/constants/styles';

const IS_WEB = Platform.OS === 'web';

interface ToggleChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

const ToggleChip: React.FC<ToggleChipProps> = ({ label, selected, onPress }) => {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onHoverIn={IS_WEB ? () => setHovered(true) : undefined}
      onHoverOut={IS_WEB ? () => setHovered(false) : undefined}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[
        styles.chip,
        selected && styles.chipSelected,
        !selected && (pressed || hovered) && styles.chipHovered,
      ]}
    >
      <BloomText style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
        {label}
      </BloomText>
    </Pressable>
  );
};

interface YesNoSelectorProps {
  label: string;
  value: boolean | null | undefined;
  onChange: (value: boolean) => void;
}

export const YesNoSelector: React.FC<YesNoSelectorProps> = ({ label, value, onChange }) => {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <BloomText style={styles.fieldLabel}>{label}</BloomText>
      <View style={styles.row}>
        <ToggleChip
          label={t('common.yes')}
          selected={value === true}
          onPress={() => onChange(true)}
        />
        <ToggleChip
          label={t('common.no')}
          selected={value === false}
          onPress={() => onChange(false)}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chip: {
    minWidth: 88,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: hairline.width,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    backgroundColor: colors.surfaceElevated,
  },
  chipHovered: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  chipSelected: {
    backgroundColor: colors.COLOR_BLACK,
    borderColor: colors.COLOR_BLACK,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  chipLabelSelected: {
    color: colors.white,
  },
});

export default YesNoSelector;
