import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Field } from '@oxy.so/bloom/field';
import { StepperRow } from '@oxy.so/bloom/stepper';
import {
  SwitchFilterRow,
  ToggleChipGroup,
  type FilterIconComponent,
} from '@oxy.so/bloom/stay-filters';
import { H4 } from '@oxy.so/bloom/typography';
import { getAmenitiesByPropertyType, getAmenityById } from '@/constants/amenities';
import { createPropertyStyles as styles } from './styles';
import type { AmenitiesStepProps } from './types';

/** Upper bound for the guest-limit counter (the old field's 2-digit range). */
const MAX_GUESTS = 99;

type RuleField = 'petsAllowed' | 'smokingAllowed' | 'partiesAllowed' | 'guestsAllowed';
const RULES: readonly RuleField[] = ['petsAllowed', 'smokingAllowed', 'partiesAllowed', 'guestsAllowed'];

/**
 * "Amenities" wizard step: the amenities for the property type as a Bloom
 * `ToggleChipGroup`, then the house rules as `SwitchFilterRow`s and, when
 * guests are allowed, the guest limit.
 */
export function AmenitiesStep({
  formData,
  validationErrors,
  updateFormField,
  onAmenityToggle,
}: AmenitiesStepProps) {
  const { t } = useTranslation();
  const { amenities, rules, basicInfo } = formData;
  const selected = useMemo(() => amenities.selectedAmenities ?? [], [amenities.selectedAmenities]);

  const options = useMemo(
    () =>
      getAmenitiesByPropertyType(basicInfo.propertyType).flatMap((id) => {
        const amenity = getAmenityById(id);
        if (!amenity) return [];
        return [
          {
            value: amenity.id,
            label: amenity.nameKey ? t(amenity.nameKey) : amenity.name,
            // The catalog types its glyphs as Button icons; they are the same
            // Bloom Remix components the chips draw.
            icon: amenity.icon as FilterIconComponent,
          },
        ];
      }),
    [basicInfo.propertyType, t],
  );

  // The group reports the whole next selection; the form keeps the order the
  // host picked in, so apply only the one amenity that changed.
  const handleAmenities = (next: string[]) => {
    const changed =
      next.find((id) => !selected.includes(id)) ?? selected.find((id) => !next.includes(id));
    if (changed) onAmenityToggle(changed);
  };

  return (
    <View style={styles.step}>
      <ToggleChipGroup
        options={options}
        value={selected}
        onValueChange={handleAmenities}
        accessibilityLabel={t('propertyCreate.amenities.title')}
        testID="create-amenities"
      />

      <H4>{t('propertyCreate.amenities.houseRules')}</H4>

      <View style={styles.switches}>
        {RULES.map((rule) => (
          <SwitchFilterRow
            key={rule}
            title={t(`propertyCreate.amenities.${rule}`)}
            value={Boolean(rules?.[rule])}
            onValueChange={(value) => updateFormField('rules', rule, value)}
          />
        ))}
      </View>

      {rules?.guestsAllowed && (
        <Field error={validationErrors.maxGuests}>
          {/* 0 draws "—" and stores `undefined`: an unset limit stays unset. */}
          <StepperRow
            title={t('propertyCreate.amenities.maxGuests')}
            value={rules.maxGuests ?? 0}
            onValueChange={(value) => updateFormField('rules', 'maxGuests', value || undefined)}
            min={0}
            max={MAX_GUESTS}
            formatValue={(value) => (value === 0 ? '—' : String(value))}
            decrementLabel={t('common.decreaseItem', {
              title: t('propertyCreate.amenities.maxGuests'),
            })}
            incrementLabel={t('common.increaseItem', {
              title: t('propertyCreate.amenities.maxGuests'),
            })}
            testID="create-max-guests"
          />
        </Field>
      )}
    </View>
  );
}
