/**
 * EnumChipSelector — a generic chip row for a dimension enum.
 *
 * Give it the enum's values + an i18n key prefix (`reviews.enums.<field>`) and
 * it renders one labelled chip per value. `multiple` switches between
 * single-select (tap replaces, tapping the selected chip clears) and
 * multi-select (toggle in/out of the set). The value in and out is ALWAYS a
 * flat array, so a single-select field wraps its optional value:
 * `selected={value ? [value] : []}` / `onChange={(next) => update(field, next[0])}`.
 *
 * The chip is its OWN component (`EnumChip`) with static style arrays +
 * `onPressIn`/`onPressOut`/`onHoverIn`/`onHoverOut` state — never the
 * NativeWind-incompatible function-form `style`, and safe inside the `.map`
 * (AGENTS.md §NativeWind Pressable).
 */
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { hairline, radius, spacing } from '@/constants/styles';

const IS_WEB = Platform.OS === 'web';

interface EnumChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/** One selectable chip — owns its own pressed/hovered state. */
const EnumChip: React.FC<EnumChipProps> = ({ label, selected, onPress }) => {
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

export interface EnumChipSelectorProps<T extends string> {
  /** Enum values to render, in display order. */
  values: readonly T[];
  /** i18n key prefix — each chip's label is `t(`${labelPrefix}.${value}`)`. */
  labelPrefix: string;
  /** Optional field label rendered above the chip row. */
  label?: string;
  /** Multi-select toggles set membership; single-select replaces / clears. */
  multiple?: boolean;
  /** Currently selected values (always an array; empty when nothing is chosen). */
  selected: readonly T[];
  /** Fired with the next selected array. */
  onChange: (next: T[]) => void;
}

export function EnumChipSelector<T extends string>({
  values,
  labelPrefix,
  label,
  multiple = false,
  selected,
  onChange,
}: EnumChipSelectorProps<T>) {
  const { t } = useTranslation();

  const toggle = (value: T) => {
    if (multiple) {
      onChange(
        selected.includes(value)
          ? selected.filter((entry) => entry !== value)
          : [...selected, value],
      );
      return;
    }
    onChange(selected.includes(value) ? [] : [value]);
  };

  return (
    <View style={styles.container}>
      {label ? <BloomText style={styles.label}>{label}</BloomText> : null}
      <View style={styles.chips}>
        {values.map((value) => (
          <EnumChip
            key={value}
            label={t(`${labelPrefix}.${value}`)}
            selected={selected.includes(value)}
            onPress={() => toggle(value)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.lg,
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
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  chipLabelSelected: {
    color: colors.white,
  },
});

export default EnumChipSelector;
