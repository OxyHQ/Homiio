import React, { useCallback, useMemo, useState } from 'react';
import { View, Image, StyleSheet, Pressable, TouchableOpacity, ViewStyle, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import { PriceUnit, Property } from '@homiio/shared-types';
import {
  getPropertyTitle,
  getPropertyImageSource,
  getPropertyLocationLabel,
  resolveOfferingSummaries,
  resolvePrimaryOffering,
} from '@/utils/propertyUtils';

import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { useRentalMode } from '@/context/RentalModeContext';

import { SaveButton } from './SaveButton';
import { CurrencyFormatter } from './CurrencyFormatter';
import { OfferingBadge } from './property/OfferingBadge';
import { MediaChip } from './property/MediaChip';
import { PropertyImageCarousel } from './property/PropertyImageCarousel';
import { ZoomableImage } from '@/components/ui/ZoomableImage';
import { ThemedText } from '@/components/ThemedText';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { prefetchProperty, prefetchPropertyStats } from '@/utils/queryPrefetch';
import { PropertyCardSkeleton } from './ui/skeletons/PropertyCardSkeleton';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** A listing counts as "new" (badge) while its `createdAt` is within this window. */
const NEW_LISTING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function shouldShowInstantBook(
  property: Property,
  mode: 'long_term' | 'vacation',
): boolean {
  if (mode !== 'vacation') return false;
  // Instant book is a short-term-offering property — read it off that block.
  return Boolean(property.shortTermRent?.instantBook);
}

export type PropertyCardVariant = 'default' | 'compact' | 'featured' | 'saved' | 'grid';
export type PropertyCardOrientation = 'vertical' | 'horizontal';

/**
 * Property objects can be momentarily flagged as `isSaved` by the server
 * response while the saved-properties context is still bootstrapping. We
 * type that optional flag here instead of casting through `any`.
 */
type PropertyWithSavedHint = Property & { readonly isSaved?: boolean };

type PropertyCardProps = {
  // Core data - now primarily uses property object
  property: Property;

  // Display options
  variant?: PropertyCardVariant;
  orientation?: PropertyCardOrientation;
  showSaveButton?: boolean;
  showVerifiedBadge?: boolean;
  showTypeIcon?: boolean;
  showFeatures?: boolean;
  showPrice?: boolean;
  showLocation?: boolean;
  showRating?: boolean;
  showSaveCount?: boolean;
  saveCountDisplayMode?: 'badge' | 'inline';
  /**
   * Render the photo box as a swipeable image carousel (Airbnb-style) when the
   * listing has more than one photo. Only applies to vertical orientation — the
   * horizontal thumbnail variant always shows the single cover image. Defaults
   * to `true`; pass `false` for surfaces where an in-card horizontal pager would
   * fight an enclosing horizontal scroller.
   */
  enableImageCarousel?: boolean;

  // State
  isSelected?: boolean;
  isProcessing?: boolean;
  isLoading?: boolean;

  // Actions
  onPress?: () => void;
  onLongPress?: () => void;

  // Styling
  style?: ViewStyle;
  imageHeight?: number;
  titleLines?: number;
  locationLines?: number;

  // Custom content
  footerContent?: React.ReactNode;
  badgeContent?: React.ReactNode;
  overlayContent?: React.ReactNode;

  // Saved-specific
  noteText?: string;
  onPressNote?: () => void;
};

// const { width: screenWidth } = Dimensions.get('window');

const getVariantStyles = (variant: PropertyCardVariant) => {
  const variants = {
    compact: {
      imageHeight: 60,
      showFeatures: true,
      showTypeIcon: false,
      showRating: false,
      titleLines: 2,
      locationLines: 1,
      showPrice: false,
    },
    featured: {
      imageHeight: 140,
      showFeatures: true,
      showTypeIcon: true,
      showRating: true,
      titleLines: 2,
      locationLines: 2,
      showPrice: true,
    },
    saved: {
      imageHeight: 120,
      showFeatures: true,
      showTypeIcon: false,
      showRating: true,
      titleLines: 2,
      locationLines: 1,
      showPrice: true,
    },
    /**
     * Airbnb-2026 grid variant — photo-first card used in dense, multi-
     * column merchandising grids (no overlays, no rating, single heart
     * top-right, minimal text below).
     */
    grid: {
      imageHeight: 0,
      showFeatures: false,
      showTypeIcon: false,
      showRating: false,
      titleLines: 1,
      locationLines: 1,
      showPrice: true,
    },
    default: {
      imageHeight: 120,
      showFeatures: true,
      showTypeIcon: false,
      showRating: true,
      titleLines: 2,
      locationLines: 1,
      showPrice: true,
    },
  };

  return variants[variant] || variants.default;
};

export function PropertyCard({
  // Core data
  property,

  // Display options
  variant = 'default',
  orientation = 'vertical',
  showSaveButton = true,
  showVerifiedBadge = true,
  showTypeIcon = true,
  showFeatures = true,
  showPrice = true,
  showLocation = true,
  showRating = true,
  showSaveCount = false,
  saveCountDisplayMode = 'badge',
  enableImageCarousel = true,

  // State
  isSelected = false,
  isProcessing = false,
  isLoading = false,

  // Actions
  onPress,
  onLongPress,

  // Styling
  style,
  imageHeight,
  titleLines,
  locationLines,

  // Custom content
  footerContent,
  badgeContent,
  overlayContent,
  noteText,
  onPressNote,
}: PropertyCardProps) {
  // Use saved properties context to check if property is saved
  const { isPropertySaved, isInitialized } = useSavedPropertiesContext();
  const { mode, browseMode } = useRentalMode();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  // Define the callback function (using property parameter directly)
  const handlePressIn = useCallback(() => {
    if (!property) return;
    const idToPrefetch = property._id || property.id;
    if (idToPrefetch) {
      prefetchProperty(queryClient, idToPrefetch as string);
      prefetchPropertyStats(queryClient, idToPrefetch as string);
    }
  }, [queryClient, property]);

  const showInstantBook = useMemo(
    () => (property ? shouldShowInstantBook(property, mode) : false),
    [property, mode],
  );

  // Native press-zoom for the static-image path: the photo zooms inside its
  // rounded mask via `ZoomableImage` (the card itself never scales). Web hover is
  // owned by `ZoomableImage` internally; this only tracks the touch press so the
  // image eases back out on release. Static-array styles driven by state, never
  // the NativeWind-incompatible function-form `style` (AGENTS.md §NativeWind
  // Pressable). The prefetch still fires on press-in.
  const [pressed, setPressed] = useState(false);
  const handleImagePressIn = useCallback(() => {
    setPressed(true);
    handlePressIn();
  }, [handlePressIn]);
  const handleImagePressOut = useCallback(() => {
    setPressed(false);
  }, []);

  // Web hover on the WHOLE card drives the image zoom (Airbnb-style): one
  // `onPointerEnter/Leave` on the outer container below (they fire on the card's
  // own boundary and don't bubble between children on RN-Web), so hovering the
  // text/body zooms the photo too. This ONLY feeds `ZoomableImage`'s `active` —
  // the card itself never scales/lifts (that "cutrada" was removed). OR-ed with
  // the touch press so native still gets a press-zoom.
  const [hovered, setHovered] = useState(false);
  const imageActive = hovered || pressed;

  // "New" freshness badge — pure frontend, no pagination risk. Memoized on
  // `createdAt` so `Date.now()` is captured once per listing (the 7-day boundary
  // rarely flips mid-session) rather than read impurely on every render.
  const isNew = useMemo(() => {
    const createdAt = property?.createdAt;
    if (!createdAt) return false;
    const created = new Date(createdAt).getTime();
    return Number.isFinite(created) && Date.now() - created <= NEW_LISTING_WINDOW_MS;
  }, [property?.createdAt]);

  // Show skeleton loading state
  if (isLoading) {
    return (
      <PropertyCardSkeleton
        variant={variant}
        orientation={orientation}
        showSaveButton={showSaveButton}
        showRating={showRating}
        showPrice={showPrice}
        showFeatures={showFeatures}
        showLocation={showLocation}
        imageHeight={imageHeight}
      />
    );
  }

  // Early return if property is null/undefined
  if (!property) {
    return null;
  }

  // The single primary price/offering this card displays — the ACTIVE browse
  // mode's priced block (the unit is fixed per block, never reinterpreted): a
  // multi-offering listing shows €1,700/month in Long-term and €110/night in
  // Vacation. A sale shows the asking price (no per-unit suffix); an exchange
  // shows "Free". When the listing doesn't carry the active offering,
  // `resolvePrimaryOffering` falls back to the first present block.
  const primaryOffering = resolvePrimaryOffering(
    property,
    browseMode,
    t('listing.exchange.free', 'Free'),
  );

  // The OTHER offerings this multi-offering listing carries (excluding the one
  // shown above) drive both the floating badges and the subtle "Also available"
  // line. Empty for single-offering listings.
  const otherOfferings = resolveOfferingSummaries(property, browseMode);

  // Extract data from property object
  const propertyData = {
    id: property._id || property.id,
    title: getPropertyTitle(property),
    location: getPropertyLocationLabel(property),
    price: primaryOffering.amount,
    currency: primaryOffering.currency,
    priceUnit: primaryOffering.priceUnit,
    offeringKind: primaryOffering.kind,
    offeringLabel: primaryOffering.label,
    type: property.type === 'room' ? 'apartment' : property.type === 'studio' ? 'apartment' : property.type,
    imageSource: getPropertyImageSource(property, variant === 'compact' ? 'small' : 'medium'),
    bedrooms: property.bedrooms || 0,
    bathrooms: property.bathrooms || 0,
    size: property.squareFootage || 0,
    sizeUnit: 'm²',
    isVerified: property.isVerified || false,
    rating: undefined as number | undefined,
    reviewCount: undefined as number | undefined,
  };

  // Localized per-unit suffix for the headline (fixed per priced block):
  // long-term → "month", short-term → "night"; sale/exchange have none.
  const priceUnitSuffix = propertyData.priceUnit
    ? propertyData.priceUnit === PriceUnit.NIGHT
      ? t('listing.offering.perNightUnit', 'night')
      : t('listing.offering.perMonthUnit', 'month')
    : '';

  // "Also available: By night · For sale" — joins the other offerings' labels.
  const alsoAvailableLabel =
    otherOfferings.length > 0
      ? `${t('listing.offering.alsoAvailable', 'Also available')}: ${otherOfferings
          .map((summary) => t(summary.i18nKey, summary.fallback))
          .join(' · ')}`
      : '';

  // Property type surfaced in the META line below the photo (declutters the
  // photo — the type icon no longer floats over the image). Icon follows the
  // former on-photo logic (house → home glyph, everything else → building);
  // the label reuses the `properties.titles.types.*` vocabulary, falling back to
  // the capitalised raw type for kinds without a dedicated key.
  const typeMeta: { icon: IoniconName; label: string } | null = propertyData.type
    ? {
        icon: propertyData.type === 'house' ? 'home-outline' : 'business-outline',
        label: t(
          `properties.titles.types.${propertyData.type}`,
          propertyData.type.charAt(0).toUpperCase() + propertyData.type.slice(1),
        ),
      }
    : null;

  const isEco = Boolean(property.isEcoFriendly);
  const isFairPrice = Boolean(property.priceEthics?.isFairPrice);
  const isFeatured = variant === 'featured';
  const isGrid = variant === 'grid';
  const isCompact = variant === 'compact';
  const propertyWithSavedHint = property as PropertyWithSavedHint;
  const isPropertySavedState = propertyData.id
    ? isInitialized
      ? isPropertySaved(propertyData.id)
      : propertyWithSavedHint.isSaved ?? false
    : false;

  /**
   * Grid cards present a photo-first layout. Long-term flats look better
   * square (more wall surface visible), vacation rentals breathe in 4:3
   * so the landscape framing reads. Featured/default carousels keep
   * their existing square aspect.
   */
  const gridAspectRatio = mode === 'vacation' ? 4 / 3 : 1;

  /**
   * The swipeable in-card carousel only makes sense for the full-bleed,
   * vertical photo box. Horizontal rows show a small square thumbnail and the
   * tiny `compact` tile is too small to page through, so both keep the single
   * cover image. The carousel itself renders a static photo when the listing
   * has 0–1 images, so this gate is purely about *where* a pager belongs.
   */
  const useCarousel =
    enableImageCarousel && orientation === 'vertical' && variant !== 'compact';
  const mediaAspectRatio = isGrid ? gridAspectRatio : 1;

  // Get variant-specific styles
  const variantStyles = getVariantStyles(variant);

  // Apply variant-specific overrides
  const finalImageHeight = imageHeight || variantStyles.imageHeight;
  const finalShowFeatures = showFeatures && variantStyles.showFeatures;
  const finalShowTypeIcon = showTypeIcon && variantStyles.showTypeIcon;
  const finalShowRating = showRating && variantStyles.showRating;
  const finalShowPrice = showPrice && (variantStyles.showPrice !== false);
  const finalTitleLines = titleLines !== undefined ? titleLines : variantStyles.titleLines;
  const finalLocationLines = locationLines !== undefined ? locationLines : variantStyles.locationLines;

  /**
   * Badge chrome that floats over the photo (rating, eco/verified, instant
   * book, type, external source, plus any caller-supplied badge/overlay).
   * Shared verbatim by the carousel media (as `children`) and the static-image
   * media so the overlays read identically regardless of which path renders.
   * Every node here is a non-interactive `View`, so it never introduces a
   * nested `<button>` on web.
   */
  const mediaBadges = (
    <>
      {/* Photo-overlay chip stack — ONE absolutely-positioned, flex-driven
          container in the top-left. Every child is a `MediaChip` (or the
          rating chip), so they share the same height, radius, padding and
          frosted backdrop and align on a single row regardless of which are
          present — absent chips leave no gap, present ones never collide, and
          there are no per-badge magic offsets. Suppressed in the grid variant
          to keep those cards photo-first. The stack lives in the top-LEFT, the
          opposite corner from the save heart (top-right), so they never
          overlap; the carousel dots sit bottom-centre, also clear.

          Order (freshness leads, then offerings, then provenance/status): new →
          rating → offerings → instant book → verified → eco. The compact
          ("small") card is too small to host any of this — its photo shows only
          the save heart — so the whole stack is suppressed on compact. The grid
          variant stays photo-first, so it renders ONLY the freshness chip (the
          rich chips are gated on `!isGrid`). */}
      {!isCompact && (isNew || !isGrid) && (
        <View style={styles.mediaChipStack}>
          {isNew ? (
            <View style={styles.newChip}>
              <BloomText style={styles.newChipText}>
                {t('listing.badge.new', 'New')}
              </BloomText>
            </View>
          ) : null}

          {!isGrid ? (
            <>
          {finalShowRating && propertyData.rating ? (
            <MediaChip
              icon="star"
              accent={colors.ratingStar}
              label={propertyData.rating.toFixed(1)}
            />
          ) : null}

          {/* Offering chips — "By night" / "For sale" / "Exchange" for each
              OTHER offering this listing carries (the active one is the price). */}
          {otherOfferings.map((summary) => (
            <OfferingBadge key={summary.offering} offering={summary.offering} size="md" />
          ))}

          {/* Fair price — Homiio ethical + market badge. */}
          {isFairPrice ? (
            <MediaChip
              icon="pricetag"
              accent={colors.success}
              label={t('listing.badge.fairPrice', 'Fair price')}
            />
          ) : null}

          {/* Instant Book (vacation mode only). */}
          {showInstantBook ? (
            <MediaChip
              icon="flash"
              accent={colors.primarySubtleForeground}
              label={t('listing.badge.instantBook', 'Instant book')}
            />
          ) : null}

          {/* Verified — icon-only shield, brand accent. */}
          {showVerifiedBadge && propertyData.isVerified ? (
            <MediaChip icon="shield-checkmark" accent={colors.primarySubtleForeground} />
          ) : null}

          {/* Eco — icon-only leaf, green accent. */}
          {isEco ? <MediaChip icon="leaf" accent={colors.success} /> : null}
            </>
          ) : null}
        </View>
      )}

      {/* Custom Badge Content */}
      {badgeContent && <View style={styles.customBadge}>{badgeContent as React.ReactNode}</View>}

      {/* Overlay Content */}
      {overlayContent && <View style={styles.overlay}>{overlayContent as React.ReactNode}</View>}
    </>
  );

  const textContent = (
    <View
      style={[
        styles.content,
        orientation === 'horizontal' ? styles.horizontalContent : null,
        isGrid ? styles.gridContent : null,
      ]}
    >
      {/* Title */}
      <ThemedText
        style={[
          styles.title,
          isFeatured ? styles.featuredTitle : null,
          isGrid ? styles.gridTitle : null,
        ]}
        numberOfLines={orientation === 'horizontal' ? undefined : finalTitleLines}
      >
        {propertyData.title}
      </ThemedText>

      {/* Location */}
      {showLocation && propertyData.location && (
        <ThemedText
          style={[
            styles.location,
            isFeatured ? styles.featuredLocation : null,
            orientation === 'horizontal' ? styles.horizontalLocation : null,
            isGrid ? styles.gridLocation : null,
          ]}
          numberOfLines={finalLocationLines}
        >
          {propertyData.location}
        </ThemedText>
      )}

      {/* Features — suppressed in grid variant to keep cards photo-first */}
      {finalShowFeatures && !isGrid && (
        <View style={styles.features}>
          {/* Property type leads the meta line (moved off the photo). Shown for
              the variants that previously surfaced the on-photo type icon; the
              compact variant keeps its own trailing type text below. */}
          {finalShowTypeIcon && typeMeta && variant !== 'compact' && (
            <>
              <View style={styles.typeMeta}>
                <Ionicons name={typeMeta.icon} size={13} color={colors.COLOR_BLACK_LIGHT_4} />
                <ThemedText style={styles.featureText}>{typeMeta.label}</ThemedText>
              </View>
              <ThemedText style={styles.featureSeparator}>•</ThemedText>
            </>
          )}
          <View style={styles.feature}>
            <ThemedText style={styles.featureText}>
              {`${propertyData.bedrooms} bed${propertyData.bedrooms !== 1 ? 's' : ''}`}
            </ThemedText>
          </View>
          <ThemedText style={styles.featureSeparator}>•</ThemedText>
          <View style={styles.feature}>
            <ThemedText style={styles.featureText}>
              {`${propertyData.bathrooms} bath${propertyData.bathrooms !== 1 ? 's' : ''}`}
            </ThemedText>
          </View>
          {propertyData.size && propertyData.size > 0 && (
            <>
              <ThemedText style={styles.featureSeparator}>•</ThemedText>
              <View style={styles.feature}>
                <ThemedText style={styles.featureText}>
                  {`${propertyData.size} ${propertyData.sizeUnit}`}
                </ThemedText>
              </View>
            </>
          )}
          {variant === 'compact' && propertyData.type && (
            <>
              <ThemedText style={styles.featureSeparator}>•</ThemedText>
              <ThemedText style={styles.featureText}>{propertyData.type}</ThemedText>
            </>
          )}
        </View>
      )}

      {/* Price — the ACTIVE browse mode's priced block. Exchange listings have
          no money price, so they render the "Free" label instead of
          CurrencyFormatter; sale shows the sale price with NO per-unit suffix;
          long-term shows `/month` and short-term `/night` (fixed per block). */}
      {finalShowPrice &&
        (propertyData.offeringKind === 'exchange'
          ? propertyData.offeringLabel.length > 0
          : propertyData.price > 0) && (
        <View style={[styles.priceContainer, isGrid ? styles.gridPriceContainer : null]}>
          <BloomText
            style={[
              styles.price,
              isFeatured ? styles.featuredPrice : null,
              isGrid ? styles.gridPrice : null,
            ]}
          >
            {propertyData.offeringKind === 'exchange' ? (
              propertyData.offeringLabel
            ) : (
              <>
                <CurrencyFormatter
                  amount={propertyData.price}
                  originalCurrency={propertyData.currency}
                  showConversion={false}
                />
                {priceUnitSuffix ? (
                  <BloomText style={[styles.priceUnit, isGrid ? styles.gridPriceUnit : null]}>
                    {' / '}{priceUnitSuffix}
                  </BloomText>
                ) : null}
              </>
            )}
          </BloomText>
        </View>
      )}

      {/* "Also available: By night · For sale" — the OTHER offerings this
          multi-offering listing carries. Hidden in the dense grid + compact
          tiles to keep them photo-first. */}
      {finalShowPrice && !isGrid && variant !== 'compact' && alsoAvailableLabel ? (
        <BloomText style={styles.alsoAvailable} numberOfLines={1}>
          {alsoAvailableLabel}
        </BloomText>
      ) : null}
    </View>
  );

  return (
    <View
      // Web hover on the WHOLE card boundary feeds the image zoom (no card
      // transform). `onPointerEnter/Leave` fire on this container's edge and
      // don't re-fire moving between children on RN-Web, so hovering anywhere —
      // photo OR text — zooms the photo. Native has no hover; press drives it.
      onPointerEnter={Platform.OS === 'web' ? () => setHovered(true) : undefined}
      onPointerLeave={Platform.OS === 'web' ? () => setHovered(false) : undefined}
      style={[
        styles.container,
        style as ViewStyle,
        isProcessing ? { opacity: 0.7 } : null,
      ]}
    >
      {useCarousel ? (
        // Carousel path: the swipeable media is its OWN tap target (its pages
        // forward `onPress`), and the text block below is a SIBLING tap target.
        // Keeping them as siblings (rather than nesting the carousel inside an
        // outer body button) avoids nested <button> elements on web while still
        // making the whole card open the detail screen on tap.
        <View style={styles.body}>
          <PropertyImageCarousel
            images={property.images}
            coverIndex={property.coverImageIndex}
            aspectRatio={mediaAspectRatio}
            borderRadius={isGrid ? radius.photo : radius.lg}
            imageActive={imageActive}
            onPress={onPress}
            onPressIn={handlePressIn}
            onLongPress={onLongPress}
            accessibilityLabel={propertyData.title}
          >
            {mediaBadges}
          </PropertyImageCarousel>
          <Pressable
            style={styles.contentPressable}
            onPress={onPress}
            onPressIn={handlePressIn}
            onLongPress={onLongPress}
            accessibilityRole="button"
            accessibilityLabel={propertyData.title}
          >
            {textContent}
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={[
            styles.body,
            orientation === 'horizontal' ? styles.horizontalBody : null,
          ]}
          onPress={onPress}
          onPressIn={handleImagePressIn}
          onPressOut={handleImagePressOut}
          onLongPress={onLongPress}
          accessibilityRole="button"
          accessibilityLabel={propertyData.title}
        >
          <View
            style={[
              styles.imageContainer,
              isGrid ? styles.gridImageContainer : null,
              orientation === 'horizontal' ? styles.horizontalImageContainer : null,
              isSelected ? styles.selectedImage : null,
              orientation === 'horizontal'
                ? { height: finalImageHeight, width: finalImageHeight }
                : isGrid
                  ? { width: '100%', aspectRatio: gridAspectRatio }
                  : { width: '100%', aspectRatio: 1 },
            ]}
          >
            {/* The photo zooms inside the rounded mask on hover (anywhere on the
                card) / press; the card never moves. Badges are siblings of the
                zoom so they stay put. */}
            <ZoomableImage active={imageActive} style={styles.imageZoom}>
              <Image source={propertyData.imageSource} style={styles.image} resizeMode="cover" />
            </ZoomableImage>
            {mediaBadges}
          </View>

          {textContent}
        </Pressable>
      )}

      {/* Save Button — lives in an absolutely-positioned overlay that mirrors
          the photo box, as a SIBLING of the body Pressable. This keeps the
          heart its own tap target without nesting a <button> inside the card
          button (invalid HTML + hydration error on web). The overlay matches
          the image geometry per orientation so the heart stays pinned to the
          photo's top-right corner. */}
      {showSaveButton && (
        <View
          style={[
            styles.mediaOverlay,
            { pointerEvents: 'box-none' },
            orientation === 'horizontal'
              ? { width: finalImageHeight, height: finalImageHeight }
              : { left: 0, right: 0, aspectRatio: isGrid ? gridAspectRatio : 1 },
          ]}
        >
          <SaveButton
            isSaved={isPropertySavedState}
            size={variant === 'compact' ? 5 : 24}
            variant="heart"
            chrome="overlay"
            color={colors.COLOR_BLACK}
            activeColor={colors.busy}
            style={styles.saveButton}
            property={property}
            showCount={showSaveCount}
            countDisplayMode={saveCountDisplayMode}
          />
        </View>
      )}

      {/* Inline Note — sibling of the body Pressable, its own tap target. */}
      {(onPressNote || (noteText && noteText.trim().length > 0)) && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onPressNote}
          style={StyleSheet.flatten([
            styles.noteContainer,
            (!noteText || noteText.trim().length === 0) && styles.noteEmpty,
            variant === 'compact' && styles.compactNoteContainer,
          ])}
        >
          <View style={styles.noteRow}>
            <View style={styles.noteIconWrap}>
              <Ionicons name="document-text-outline" size={14} color={colors.primaryColor} />
            </View>
            <ThemedText
              numberOfLines={variant === 'compact' ? 1 : 2}
              style={StyleSheet.flatten([
                styles.noteText,
                (!noteText || noteText.trim().length === 0) && styles.notePlaceholder,
                variant === 'compact' && styles.compactNoteText,
              ])}
            >
              {noteText && noteText.trim().length > 0 ? noteText : 'Add a note'}
            </ThemedText>
            <Ionicons name="create-outline" size={16} color={colors.primaryColor} />
          </View>
        </TouchableOpacity>
      )}

      {/* Footer Content */}
      {footerContent && <View style={styles.footer}>{footerContent as React.ReactNode}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  // ===== BASE STYLES (shared across all variants) =====
  container: {
    width: '100%',
    height: 'auto',
    position: 'relative',
    gap: spacing.sm,
  },
  body: {
    width: '100%',
    gap: spacing.sm,
  },
  // The text block under the carousel media. Its own tap target (a sibling of
  // the carousel, not nested inside it) so the whole card opens the detail
  // without nesting a <button> in a <button> on web.
  contentPressable: {
    width: '100%',
  },
  horizontalBody: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  imageContainer: {
    position: 'relative',
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  /**
   * Grid variant — photos read as proper Airbnb tiles: rounder corners
   * (24px) and no shadow on the photo itself (the cell handles spacing).
   */
  gridImageContainer: {
    borderRadius: radius.photo,
  },
  horizontalImageContainer: {
    flexShrink: 0,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  // The masked zoom wrapper fills the image box so the photo scales inside the
  // card's rounded corners without nudging the layout.
  imageZoom: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
    gap: 2,
  },
  horizontalContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    lineHeight: 20,
  },
  location: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    lineHeight: 18,
  },
  horizontalLocation: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_4,
    lineHeight: 18,
  },
  features: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  featureSeparator: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginHorizontal: spacing.xs,
  },
  priceContainer: {
    marginTop: 'auto',
  },
  price: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  priceUnit: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  // Subtle secondary line under the price listing the listing's OTHER offerings.
  alsoAvailable: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginTop: 2,
  },

  // Badge and overlay styles (shared)
  // Absolute layer pinned to the top-left of the card that mirrors the photo
  // box; hosts the SaveButton as a sibling of the body Pressable so the heart
  // never nests inside the card's button element.
  mediaOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 2,
  },
  // Positioning only — the frosted-white chrome comes from `SaveButton`'s
  // `chrome="overlay"` variant.
  saveButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    zIndex: 2,
  },
  /**
   * The single photo-overlay chip stack. Absolutely pinned to the top-left at a
   * uniform `spacing.sm` inset (the same inset the save heart uses on the
   * top-right), it lays its `MediaChip` children out with `flexDirection: 'row'`
   * + `flexWrap` + `gap`, so the chips flow and align automatically — no
   * per-badge `position`/`top`/`left` magic numbers. `maxWidth` keeps a busy
   * stack from running under the top-right heart; overflow wraps to a new row.
   */
  mediaChipStack: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    maxWidth: '78%',
    zIndex: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  /**
   * Freshness "New" chip — a compact frosted-white pill that matches the on-card
   * Save heart (`rgba(255,255,255,0.95)`, black glyph) sitting in the opposite
   * corner, so the overlay set reads as one flat Airbnb-style family. Shorter and
   * tighter than a `MediaChip`; no shadow (Airbnb-flat).
   */
  newChip: {
    height: 20,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
  },
  newChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  // Property type in the meta line below the photo (icon + label), replacing the
  // former on-photo type chip.
  typeMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },

  // Note styles (shared)
  noteContainer: {
    marginTop: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
  },
  noteEmpty: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
    borderStyle: 'dashed',
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  noteIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  noteText: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 18,
  },
  notePlaceholder: {
    color: colors.COLOR_BLACK_LIGHT_5,
    fontStyle: 'italic',
  },

  // Footer and overlay styles (shared)
  footer: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.COLOR_BLACK_LIGHT_6,
  },
  selectedImage: {
    borderWidth: 2,
    borderColor: colors.primaryColor,
    borderRadius: 25,
  },
  customBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },

  // ===== COMPACT VARIANT STYLES =====
  compactNoteContainer: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  compactNoteText: {
    fontSize: 12,
    lineHeight: 16,
  },

  // ===== FEATURED VARIANT STYLES =====
  featuredTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  featuredLocation: {
    fontSize: 13,
  },
  featuredPrice: {
    fontSize: 15,
  },

  // ===== GRID VARIANT STYLES =====
  /**
   * Tighter content block under the photo. The grid lives at a wider
   * cadence than carousels — copy stays small so the photo dominates.
   */
  gridContent: {
    gap: 2,
    paddingTop: spacing.sm,
    paddingHorizontal: 2,
  },
  gridTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    lineHeight: 20,
  },
  gridLocation: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.COLOR_BLACK_LIGHT_4,
    lineHeight: 18,
  },
  gridPriceContainer: {
    marginTop: 4,
  },
  gridPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  gridPriceUnit: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.COLOR_BLACK_LIGHT_4,
  },
});
