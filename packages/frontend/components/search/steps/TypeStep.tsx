/**
 * TypeStep — property-type multi-select for the search panel.
 *
 * Renders the four user-facing property types as Bloom Chips. The label set
 * adapts to the active offering (short-term phrases "Whole house" / "Private
 * room"). Selection is multi-select; an empty selection means "any type".
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Chip } from '@oxyhq/bloom/chip';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { OfferingType, PropertyType } from '@homiio/shared-types';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

/** A selectable property type with its long-term and short-term labels. */
interface TypeOption {
  type: PropertyType;
  longTerm: string;
  vacation: string;
}

const TYPE_OPTIONS: readonly TypeOption[] = [
  { type: PropertyType.APARTMENT, longTerm: 'Apartments', vacation: 'Apartments' },
  { type: PropertyType.HOUSE, longTerm: 'Houses', vacation: 'Whole houses' },
  { type: PropertyType.ROOM, longTerm: 'Rooms', vacation: 'Private rooms' },
  { type: PropertyType.STUDIO, longTerm: 'Studios', vacation: 'Studios' },
] as const;

interface TypeStepProps {
  offering: OfferingType;
  selected: PropertyType[];
  onToggle: (type: PropertyType) => void;
  /**
   * Compact mode for the wide centered dialog: the dialog's own header already
   * names the step ("Property type"), so the step's internal heading is
   * suppressed and the inter-element gap tightens. The narrow sheet leaves this
   * `false` and keeps the per-step heading.
   */
  compact?: boolean;
}

export const TypeStep: React.FC<TypeStepProps> = ({
  offering,
  selected,
  onToggle,
  compact = false,
}) => {
  const { t } = useTranslation();
  const isVacation = offering === OfferingType.SHORT_TERM_RENT;

  return (
    <View style={compact ? styles.containerCompact : styles.container}>
      {compact ? null : (
        <BloomText style={styles.heading}>
          {t('search.step.type.title', 'What type of place?') || 'What type of place?'}
        </BloomText>
      )}
      <View style={styles.chips}>
        {TYPE_OPTIONS.map((option) => {
          const label = isVacation ? option.vacation : option.longTerm;
          const isSelected = selected.includes(option.type);
          return (
            <Chip
              key={option.type}
              variant={isSelected ? 'solid' : 'outlined'}
              color={isSelected ? 'primary' : 'default'}
              size="large"
              selected={isSelected}
              onPress={() => onToggle(option.type)}
              accessibilityLabel={t(label, label) || label}
            >
              {t(label, label) || label}
            </Chip>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  // Compact has no internal heading, so the only gap is between wrapped chip
  // rows — keep it snug for the centered dialog.
  containerCompact: {
    gap: spacing.sm,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});

export default TypeStep;
