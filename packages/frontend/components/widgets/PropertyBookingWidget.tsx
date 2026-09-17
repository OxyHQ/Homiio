/**
 * Right-column booking / apply widget for the property detail screen.
 *
 * On wide screens (RightBar visible) the property detail page routes its
 * booking/apply card through the app shell's right column instead of inlining
 * it. This widget owns that placement: it reads the same property as the
 * screen (shared React Query cache key, so no duplicate request) and renders
 * `BookingCard`, which decides between the stay booking card, the apply card
 * and the external-listing card.
 *
 * `BaseWidget` adds no card chrome, because the rail reads as one continuous
 * panel; the card draws its own frame. It is not sticky itself: `AppShell`
 * pins the whole rail. Returns null while loading, when there is no property,
 * or when the listing has no booking/apply surface for the current mode, so
 * the column never shows a broken card.
 */
import React from 'react';

import { type Property } from '@homiio/shared-types';

import { BaseWidget } from '@/components/widgets/BaseWidget';
import { BookingCard } from '@/components/property/BookingCard';
import { useProperty } from '@/hooks';
import { useRentalMode } from '@/context/RentalModeContext';
import { resolveBookingMode } from '@/utils/bookingMode';

interface PropertyBookingWidgetProps {
  propertyId?: string;
}

export function PropertyBookingWidget({ propertyId }: PropertyBookingWidgetProps) {
  const { mode: rentalMode } = useRentalMode();
  const { property: apiProperty } = useProperty(propertyId ?? '');

  if (!propertyId || !apiProperty) {
    return null;
  }

  const property = apiProperty as Property;

  if (resolveBookingMode(property, rentalMode) === 'none' && !property.isExternal) {
    return null;
  }

  return (
    <BaseWidget>
      <BookingCard property={property} />
    </BaseWidget>
  );
}
