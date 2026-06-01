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
 * The card itself is FLAT (no border): the chrome here is `BaseWidget` — the
 * shared `primaryLight` + radius-15 surface every other right-column widget
 * uses — and, on web, a `position: sticky` wrapper so the card hovers as the
 * user scrolls the long detail page. Returns null while loading, when there is
 * no property, or when the listing has no booking/apply surface for the
 * current mode, so the column never shows a broken card.
 */
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { type Profile, type Property } from '@homiio/shared-types';

import { BaseWidget } from '@/components/widgets/BaseWidget';
import { BookingCard } from '@/components/property/BookingCard';
import { useProperty } from '@/hooks';
import { useRentalMode } from '@/context/RentalModeContext';
import { resolveBookingMode } from '@/utils/bookingMode';
import { resolveHeadlinePrice } from '@/utils/propertyPricing';
import profileService from '@/services/profileService';

interface PropertyBookingWidgetProps {
  propertyId?: string;
}

const STICKY_TOP_OFFSET = 80;

/** Normalize a profile id off a property, handling legacy `$oid` envelopes. */
function resolveProfileId(profileId: Property['profileId']): string | undefined {
  if (!profileId) return undefined;
  if (
    typeof profileId === 'object' &&
    profileId !== null &&
    '$oid' in profileId &&
    typeof (profileId as { $oid?: unknown }).$oid === 'string'
  ) {
    return (profileId as { $oid: string }).$oid;
  }
  if (typeof profileId === 'string') return profileId;
  return undefined;
}

export function PropertyBookingWidget({ propertyId }: PropertyBookingWidgetProps) {
  const { t } = useTranslation();
  const { mode: rentalMode } = useRentalMode();
  const { property: apiProperty } = useProperty(propertyId ?? '');

  const landlordProfileId = resolveProfileId(apiProperty?.profileId);

  // Host profile for the card's host line + Super-host badge. Shares the
  // `['profile', id]` cache key so it doesn't duplicate any other profile load.
  const { data: landlordProfile = null } = useQuery<Profile | null>({
    queryKey: ['profile', landlordProfileId],
    enabled: Boolean(landlordProfileId),
    queryFn: () => profileService.getProfileById(landlordProfileId ?? ''),
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

  const { priceLabel, priceSubtitle } = resolveHeadlinePrice(property, rentalMode, t);

  return (
    <View style={Platform.OS === 'web' ? styles.stickyWrapperWeb : undefined}>
      <BaseWidget>
        <BookingCard
          property={property}
          priceLabel={priceLabel}
          priceSubtitle={priceSubtitle}
          landlordProfile={landlordProfile}
        />
      </BaseWidget>
    </View>
  );
}

const styles = StyleSheet.create({
  stickyWrapperWeb: {
    // react-native-web emits `position: sticky` from this; the cast is
    // contained here so consumers don't see it.
    position: 'sticky' as 'absolute',
    top: STICKY_TOP_OFFSET,
  },
});
