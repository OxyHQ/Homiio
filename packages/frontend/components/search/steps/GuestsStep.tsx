/**
 * GuestsStep — vacation-only guest picker, on Bloom's `GuestPicker`.
 *
 * Only the rows that FILTER are offered:
 *
 *  - adults and children add up to the `guests` a listing must sleep (the
 *    backend compares it against `maxGuests`); infants are not offered because
 *    nothing reads them.
 *  - pets is a flag, not a count — the search can only ask for pet-friendly
 *    homes — so its row stops at one and maps to `petFriendly`.
 *
 * The adults/children split is not part of the query (a listing's capacity is
 * one number), so a reopened picker shows the total as adults.
 */
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { GuestPicker, type GuestCounts, type GuestKind } from '@oxy.so/bloom/stay-search';

const GUEST_KINDS: readonly GuestKind[] = ['adults', 'children', 'pets'];
const MAX_GUESTS = 16;
const GUEST_MAX = { pets: 1 } as const;

export interface GuestsValue {
  guests?: number;
  petFriendly?: boolean;
}

interface GuestsStepProps {
  value: GuestsValue;
  onChange: (value: GuestsValue) => void;
  /** Mirrors the adults/children split while the picker stays mounted. */
  counts?: GuestCounts;
  onCountsChange?: (counts: GuestCounts) => void;
}

/** The picker rows a query implies. */
export function guestCountsFor(value: GuestsValue): GuestCounts {
  return {
    adults: value.guests ?? 0,
    children: 0,
    infants: 0,
    pets: value.petFriendly ? 1 : 0,
  };
}

/** The query fields a picker state means. */
export function guestsValueFor(counts: GuestCounts): GuestsValue {
  const guests = counts.adults + counts.children;
  return {
    guests: guests > 0 ? guests : undefined,
    petFriendly: counts.pets > 0 ? true : undefined,
  };
}

export const GuestsStep: React.FC<GuestsStepProps> = ({ value, onChange, counts, onCountsChange }) => {
  const { t } = useTranslation();

  // The split is kept only while the owner holds it; otherwise it is derived.
  const shown = useMemo(() => {
    if (counts) {
      const mirrored = guestsValueFor(counts);
      if (mirrored.guests === value.guests && mirrored.petFriendly === value.petFriendly) return counts;
    }
    return guestCountsFor(value);
  }, [counts, value]);

  const handleChange = useCallback(
    (next: GuestCounts) => {
      onCountsChange?.(next);
      onChange(guestsValueFor(next));
    },
    [onChange, onCountsChange],
  );

  const labels = useMemo(
    () => ({
      adults: t('search.guests.adults'),
      children: t('search.guests.children'),
      pets: t('search.guests.pets'),
    }),
    [t],
  );
  const descriptions = useMemo(
    () => ({
      adults: t('search.guests.adultsDescription'),
      children: t('search.guests.childrenDescription'),
      pets: t('search.guests.petsDescription'),
    }),
    [t],
  );

  return (
    <GuestPicker
      value={shown}
      onChange={handleChange}
      kinds={GUEST_KINDS}
      max={GUEST_MAX}
      maxGuests={MAX_GUESTS}
      labels={labels}
      descriptions={descriptions}
    />
  );
};

export default GuestsStep;
