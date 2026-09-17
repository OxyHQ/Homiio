/**
 * Right-column booking / apply widget for the property detail screen.
 *
 * On wide screens (RightBar visible) the property detail page routes its
 * booking/apply card through the app shell's right column instead of inlining
 * it. This widget owns that placement: it fetches the same property as the
 * screen (shared React Query cache key, so no duplicate request), resolves the
 * same headline price + booking mode, loads the host profile (for the card's
 * host line + Super-host badge), and renders the flat `BookingCard`.
 *
 * The card itself is FLAT (no border), and so is its shell: `BaseWidget` adds
 * no card chrome, because the rail reads as one continuous panel. It is not
 * sticky itself: `AppShell` pins the whole rail, and a sticky card inside the
 * rail's own scroller slid over the widgets below it. Returns null while loading, when there is
 * no property, or when the listing has no booking/apply surface for the
 * current mode, so the column never shows a broken card.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { type Profile, type Property } from '@homiio/shared-types';

import { BaseWidget } from '@/components/widgets/BaseWidget';
import { BookingCard } from '@/components/property/BookingCard';
import { useProperty } from '@/hooks';
import { useRentalMode } from '@/context/RentalModeContext';
import { resolveBookingMode } from '@/utils/bookingMode';
import { resolveHeadlinePrice } from '@/utils/propertyPricing';
import { useFormatting } from '@/utils/format';
import profileService from '@/services/profileService';

interface PropertyBookingWidgetProps {
  propertyId?: string;
}

export function PropertyBookingWidget({ propertyId }: PropertyBookingWidgetProps) {
  const { t } = useTranslation();
  const formatting = useFormatting();
  const { mode: rentalMode } = useRentalMode();
  const { property: apiProperty } = useProperty(propertyId ?? '');

  const landlordOxyUserId = apiProperty?.oxyUserId;

  const { data: landlordProfile = null } = useQuery<Profile | null>({
    queryKey: ['profile-by-oxy', landlordOxyUserId],
    enabled: Boolean(landlordOxyUserId),
    queryFn: () => profileService.getPublicProfileByOxyUserId(landlordOxyUserId ?? ''),
  });

  if (!propertyId || !apiProperty) {
    return null;
  }

  const property = apiProperty as Property;

  // Hide the whole widget when this listing has no booking/apply surface for
  // the current mode (mirrors the screen's inline gating).
  if (resolveBookingMode(property, rentalMode) === 'none') {
    return null;
  }

  const { priceLabel, priceSubtitle } = resolveHeadlinePrice(property, rentalMode, t, formatting);

  return (
    <BaseWidget>
      <BookingCard
        property={property}
        priceLabel={priceLabel}
        priceSubtitle={priceSubtitle}
        landlordProfile={landlordProfile}
      />
    </BaseWidget>
  );
}
