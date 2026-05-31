/**
 * Right-column booking / apply widget for the property detail screen.
 *
 * On wide screens (RightBar visible) the property detail page routes its
 * booking/apply card through the app shell's right column instead of inlining
 * it. This widget owns that placement: it fetches the same property as the
 * screen (shared React Query cache key, so no duplicate request), resolves the
 * same headline price, and renders the existing StickyBookingCard — which
 * already branches vacation → BookingWidget / long-term → ApplyToRentCTA
 * internally.
 *
 * It is intentionally NOT wrapped in BaseWidget: StickyBookingCard is its own
 * card, and RightBar's sticky container already provides the hover-on-scroll
 * positioning. Returns null while loading or when there is no property, so the
 * column never shows a broken card.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import { type Property } from '@homiio/shared-types';

import { StickyBookingCard } from '@/components/property/StickyBookingCard';
import { useProperty } from '@/hooks';
import { useRentalMode } from '@/context/RentalModeContext';
import { resolveHeadlinePrice } from '@/utils/propertyPricing';

interface PropertyBookingWidgetProps {
  propertyId?: string;
}

export function PropertyBookingWidget({ propertyId }: PropertyBookingWidgetProps) {
  const { t } = useTranslation();
  const { mode: rentalMode } = useRentalMode();
  const { property: apiProperty } = useProperty(propertyId ?? '');

  if (!propertyId || !apiProperty) {
    return null;
  }

  const { priceLabel, priceSubtitle } = resolveHeadlinePrice(apiProperty, rentalMode, t);

  return (
    <StickyBookingCard
      property={apiProperty as Property}
      priceLabel={priceLabel}
      priceSubtitle={priceSubtitle}
    />
  );
}
