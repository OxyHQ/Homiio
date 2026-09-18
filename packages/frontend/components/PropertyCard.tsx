/**
 * PropertyCard — Homiio's adapter from a `Property` to Bloom's `ListingCard`.
 *
 * Bloom owns the card: the paged photo track (swipe, trackpad, hover arrows on
 * web), the dots, lazy photo mounting, the heart, the skeleton and the real
 * `<a href>` link. This file only decides WHAT the card says, from Homiio data:
 *
 *  - price: the ACTIVE browse mode's priced block (`resolvePrimaryOffering`),
 *    formatted in the listing's own currency for the reader's locale, with the
 *    block's fixed unit (month / night; none for sale; "Free" for exchange);
 *  - subtitle: the published location label (never more precise than the API
 *    gives), then beds · baths · area;
 *  - badge: ONE pill, the most useful true fact (fair price, instant book, new,
 *    verified) — never a rating: listings carry no review aggregate, so the
 *    card shows none rather than an invented one;
 *  - heart: the saved-properties context, the same mutation `SaveButton` uses.
 *
 * Two of the card's own affordances are turned on here rather than in Bloom,
 * because both are an app's decision (2.12):
 *
 *  - `hoverZoom` brings the photo forward under a pointer. Web only, behind
 *    `@media (any-hover: hover)` and off under `prefers-reduced-motion`, and
 *    the transform is inside the tile that already clips — the card does not
 *    move and the grid does not reflow.
 *  - `onLongPress` / `onContextMenu` reach the save-to-folder sheet, the same
 *    one `SaveButton`'s long press opens (`useOpenSaveToFolderSheet`). Neither
 *    event has a keyboard spelling, which is why the sheet is ALSO reachable
 *    from the property's own screen: the card's shortcut is a shortcut, never
 *    the only way in.
 */
import React, { useCallback, useMemo } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ListingCard } from '@oxy.so/bloom/listing-card';
import {
  formatArea,
  formatMoney,
  priceFrequencyFromPriceUnit,
  type Property,
} from '@homiio/shared-types';

import { useOpenSaveToFolderSheet } from '@/components/SaveToFolderBottomSheet';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { useRentalMode } from '@/context/RentalModeContext';
import { useFormatting } from '@/utils/format';
import {
  getPropertyLocationLabel,
  getPropertyPhotoUrls,
  getPropertyTitle,
  resolvePrimaryOffering,
} from '@/utils/propertyUtils';
import { prefetchProperty, prefetchPropertyStats } from '@/utils/queryPrefetch';

/** A listing counts as "new" (badge) while its `createdAt` is within this window. */
const NEW_LISTING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const IS_WEB = Platform.OS === 'web';

export type PropertyCardVariant = 'default' | 'compact';
export type PropertyCardOrientation = 'vertical' | 'horizontal';

/**
 * Property objects can be momentarily flagged as `isSaved` by the server
 * response while the saved-properties context is still bootstrapping.
 */
type PropertyWithSavedHint = Property & { readonly isSaved?: boolean };

export interface PropertyCardProps {
  property: Property;
  /** `compact` loads the small photo rendition and never pages photos. */
  variant?: PropertyCardVariant;
  /** `horizontal` is the list / map-sheet layout: a square photo 40% wide. */
  orientation?: PropertyCardOrientation;
  showSaveButton?: boolean;
  /** Whether "Verified" may be the card's badge. Default `true`. */
  showVerifiedBadge?: boolean;
  /**
   * Page through every photo. Pass `false` inside a horizontal scroller, where
   * an in-card pager would fight the row swipe: the card shows the cover only.
   */
  enableImageCarousel?: boolean;
  isLoading?: boolean;
  onPress?: () => void;
  /** Rendered under the card (owner actions, a saved note). */
  footerContent?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const PropertyCard = React.memo(function PropertyCard({
  property,
  variant = 'default',
  orientation = 'vertical',
  showSaveButton = true,
  showVerifiedBadge = true,
  enableImageCarousel = true,
  isLoading = false,
  onPress,
  footerContent,
  style,
}: PropertyCardProps) {
  const { t } = useTranslation();
  const formatting = useFormatting();
  const queryClient = useQueryClient();
  const { browseMode } = useRentalMode();
  const { isPropertySaved, isInitialized, savePropertyToFolder, unsaveProperty } =
    useSavedPropertiesContext();
  const openSaveToFolderSheet = useOpenSaveToFolderSheet();

  const propertyId = property?.id ? String(property.id) : '';

  const prefetch = useCallback(() => {
    if (!propertyId) return;
    void prefetchProperty(queryClient, propertyId);
    void prefetchPropertyStats(queryClient, propertyId);
  }, [queryClient, propertyId]);

  const content = useMemo(() => {
    if (!property) return null;

    const photos = getPropertyPhotoUrls(
      property.images,
      property.coverImageIndex,
      variant === 'compact' ? 'small' : 'medium',
    );
    const pagesPhotos = enableImageCarousel && variant !== 'compact';

    const offering = resolvePrimaryOffering(property, browseMode, t('listing.exchange.free'));
    let price: string | undefined;
    let priceUnit: string | undefined;
    if (offering.kind === 'exchange') {
      price = offering.label || undefined;
    } else if (offering.amount > 0 && offering.currency) {
      price = formatMoney(offering.amount, offering.currency, formatting.locale);
      priceUnit = offering.priceUnit
        ? formatting.priceUnitLabels[priceFrequencyFromPriceUnit(offering.priceUnit)].short
        : undefined;
    }

    const facts: string[] = [];
    if (property.bedrooms) facts.push(t('listing.card.beds', { count: property.bedrooms }));
    if (property.bathrooms) facts.push(t('listing.card.baths', { count: property.bathrooms }));
    if (property.squareFootage && property.squareFootage > 0) {
      facts.push(
        formatArea(property.squareFootage, 'sqm', formatting.locale, {
          labels: formatting.areaUnitLabels,
        }),
      );
    }

    const createdAt = property.createdAt ? new Date(property.createdAt).getTime() : NaN;
    const isNew = Number.isFinite(createdAt) && Date.now() - createdAt <= NEW_LISTING_WINDOW_MS;
    const badge = property.priceEthics?.isFairPrice
      ? t('listing.badge.fairPrice')
      : browseMode === 'vacation' && property.shortTermRent?.instantBook
        ? t('listing.badge.instantBook')
        : isNew
          ? t('listing.badge.new')
          : showVerifiedBadge && property.isVerified
            ? t('listing.badge.verified')
            : undefined;

    const title = getPropertyTitle(property);
    const subtitle = getPropertyLocationLabel(property) || undefined;
    const dates = facts.length > 0 ? facts.join(' · ') : undefined;
    const accessibilityLabel = [
      title,
      badge,
      subtitle,
      dates,
      price ? [price, priceUnit].filter(Boolean).join(' / ') : undefined,
    ]
      .filter(Boolean)
      .join(', ');

    return {
      photos: pagesPhotos ? photos : photos.slice(0, 1),
      title,
      subtitle,
      dates,
      price,
      priceUnit,
      badge,
      accessibilityLabel,
    };
  }, [property, variant, enableImageCarousel, browseMode, showVerifiedBadge, t, formatting]);

  const isSaved = propertyId
    ? isInitialized
      ? isPropertySaved(propertyId)
      : (property as PropertyWithSavedHint).isSaved ?? false
    : false;

  // Only offered where the heart is: the sheet's whole subject is which folder
  // this is saved to, which is meaningless on a card that cannot save at all.
  const handleSaveShortcut = useCallback(() => {
    if (!propertyId || !property) return;
    void openSaveToFolderSheet(property, propertyId);
  }, [propertyId, property, openSaveToFolderSheet]);

  const handleFavoriteChange = useCallback(
    (next: boolean) => {
      if (!propertyId) return;
      // The context toasts success and failure and rolls back its optimistic
      // update; the rejection it rethrows has nothing left to tell the user.
      const action = next
        ? savePropertyToFolder(propertyId, null, property)
        : unsaveProperty(propertyId);
      action.catch(() => undefined);
    },
    [propertyId, property, savePropertyToFolder, unsaveProperty],
  );

  if (!isLoading && !content) return null;

  const layout = orientation === 'horizontal' ? 'horizontal' : 'vertical';

  return (
    <View
      style={style}
      // Warm the detail query before the press lands: hover on web, touch on native.
      onPointerEnter={IS_WEB ? prefetch : undefined}
      onTouchStart={IS_WEB ? undefined : prefetch}
    >
      <ListingCard
        loading={isLoading}
        layout={layout}
        photos={content?.photos ?? []}
        title={content?.title ?? ''}
        subtitle={content?.subtitle}
        dates={content?.dates}
        price={content?.price}
        priceUnit={content?.priceUnit}
        badge={content?.badge}
        href={propertyId ? `/properties/${propertyId}` : undefined}
        onPress={onPress}
        favorite={isSaved}
        onFavoriteChange={showSaveButton && propertyId ? handleFavoriteChange : undefined}
        onLongPress={showSaveButton && propertyId ? handleSaveShortcut : undefined}
        onContextMenu={showSaveButton && propertyId ? handleSaveShortcut : undefined}
        hoverZoom
        accessibilityLabel={content?.accessibilityLabel}
        previousPhotoLabel={t('listing.card.previousPhoto')}
        nextPhotoLabel={t('listing.card.nextPhoto')}
        saveLabel={t('listing.card.save')}
        removeLabel={t('listing.card.unsave')}
      />
      {footerContent ? <View style={styles.footer}>{footerContent}</View> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  footer: { marginTop: 12 },
});

export default PropertyCard;
