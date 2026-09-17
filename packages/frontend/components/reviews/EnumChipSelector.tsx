/**
 * EnumChipSelector — a Bloom `Chip` filter group for a dimension enum.
 *
 * Give it the enum's values + an i18n key prefix (`reviews.enums.<field>`) and
 * it renders one selectable `Chip` per value. `multiple` switches between
 * single-select (tap replaces, tapping the selected chip clears) and
 * multi-select (toggle in/out of the set). The value in and out is ALWAYS a
 * flat array, so a single-select field wraps its optional value:
 * `selected={value ? [value] : []}` / `onChange={(next) => update(field, next[0])}`.
 *
 * Chips (not a RadioGroup) even for single choice: the wizard's dimensions are
 * OPTIONAL and clearable, which a radio cannot express, and a wrapped chip row
 * keeps a dozen short enum values scannable.
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Chip } from '@oxy.so/bloom/chip';
import { Label } from '@oxy.so/bloom/label';

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
    <View className="gap-2">
      {label ? <Label>{label}</Label> : null}
      <View className="flex-row flex-wrap gap-2">
        {values.map((value) => {
          const chipLabel = t(`${labelPrefix}.${value}`);
          return (
            <Chip
              key={value}
              size="medium"
              variant="outlined"
              selected={selected.includes(value)}
              onPress={() => toggle(value)}
              accessibilityLabel={chipLabel}
            >
              {chipLabel}
            </Chip>
          );
        })}
      </View>
    </View>
  );
}

export default EnumChipSelector;
