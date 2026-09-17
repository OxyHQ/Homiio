/**
 * TypeStep — property-type multi-select, on Bloom's `ToggleChipGroup`.
 *
 * The four user-facing property types, each with its glyph. The label set
 * adapts to the active offering (short-term phrases "Whole houses" / "Private
 * rooms"). An empty selection means "any type".
 */
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  RiBuilding2Line,
  RiDoorOpenLine,
  RiHome4Line,
  RiHotelBedLine,
} from '@oxy.so/bloom/icons';
import { ToggleChipGroup, type ToggleChipOption } from '@oxy.so/bloom/stay-filters';

import { OfferingType, PropertyType } from '@homiio/shared-types';

/** A selectable property type with its glyph and its long-term and short-term labels. */
export interface SearchTypeOption {
  type: PropertyType;
  icon: typeof RiBuilding2Line;
  longTermKey: string;
  vacationKey: string;
}

export const SEARCH_TYPE_OPTIONS: readonly SearchTypeOption[] = [
  {
    type: PropertyType.APARTMENT,
    icon: RiBuilding2Line,
    longTermKey: 'search.types.apartments',
    vacationKey: 'search.types.apartments',
  },
  {
    type: PropertyType.HOUSE,
    icon: RiHome4Line,
    longTermKey: 'search.types.houses',
    vacationKey: 'search.filters.propertyTypeVacation.wholeHouses',
  },
  {
    type: PropertyType.ROOM,
    icon: RiHotelBedLine,
    longTermKey: 'search.types.rooms',
    vacationKey: 'search.filters.propertyTypeVacation.privateRooms',
  },
  {
    type: PropertyType.STUDIO,
    icon: RiDoorOpenLine,
    longTermKey: 'search.types.studios',
    vacationKey: 'search.types.studios',
  },
];

/** The i18n key a type option reads under an offering. */
export function typeOptionLabelKey(option: SearchTypeOption, offering: OfferingType): string {
  return offering === OfferingType.SHORT_TERM_RENT ? option.vacationKey : option.longTermKey;
}

interface TypeStepProps {
  offering: OfferingType;
  selected: PropertyType[];
  onChange: (types: PropertyType[]) => void;
}

export const TypeStep: React.FC<TypeStepProps> = ({ offering, selected, onChange }) => {
  const { t } = useTranslation();

  const options = useMemo<ToggleChipOption<PropertyType>[]>(
    () =>
      SEARCH_TYPE_OPTIONS.map((option) => ({
        value: option.type,
        label: t(typeOptionLabelKey(option, offering)),
        icon: option.icon,
      })),
    [offering, t],
  );

  return (
    <ToggleChipGroup<PropertyType>
      options={options}
      value={selected}
      onValueChange={onChange}
      accessibilityLabel={t('search.filters.propertyType')}
    />
  );
};

export default TypeStep;
