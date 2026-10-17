/**
 * Property detail screen — Airbnb-2026 inspired layout.
 *
 * Architecture:
 *  - Bloom `ListingHeader` (title, facts, real review rating, location, share
 *    and save) and `ListingPhotoGrid` (1 + 4 grid from 744 wide, a full-bleed
 *    carousel below, where the photos lead) opening `ZoomableMediaGallery`.
 *  - The booking/apply card lives in the app shell's right column on wide
 *    screens and inline on narrow ones (`lg:hidden`); a short stay then gets
 *    Bloom's `BookingBar` pinned under the page, sharing the card's selection.
 *  - A transparent Bloom `PageHeader` over the photos reveals the title and
 *    price once the page scrolls.
 *  - Sections are flat (no cards/shadows): shared Bloom Typography, a
 *    consistent vertical rhythm (`styles.section`), and a single
 *    hairline divider between blocks. Content sits directly on the page
 *    background and aligns to one gutter.
 *  - Action bar (footer): PropertyActionBar for every other listing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from '@oxy.so/bloom/toast';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';

import { useOxy, openAccountDialog } from '@oxy.so/services';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { ButtonGroup, ButtonGroupItem } from '@oxy.so/bloom/button-group';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import {
  RiAccountCircleLine,
  RiCalendarLine,
  RiHeartFill,
  RiHeartLine,
  RiHomeLine,
  RiShapesLine,
  RiShare2Line,
} from '@oxy.so/bloom/icons';
import { BookingBar } from '@oxy.so/bloom/booking';
import {
  ListingHeader,
  ListingHeaderAction,
  ListingPhotoGrid,
} from '@oxy.so/bloom/listing-details';
import {
  ZoomableMediaGallery,
  type ZoomableMediaGalleryHandle,
} from '@oxy.so/bloom/zoomable-media-gallery';

import { ErrorState } from '@/components/ui/ErrorState';
import { useAreaInsights, useNearbyServices, useProperty } from '@/hooks';
import { useAddressReviews } from '@/hooks/useAddressReviews';
import { useStayBooking } from '@/hooks/useStayBooking';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useRentalMode } from '@/context/RentalModeContext';
import { resolveHeadlinePrice } from '@/utils/propertyPricing';
import { useFormatting } from '@/utils/format';
import {
  getPropertyLocationLabel,
  getPropertyPhotos,
  getPropertyTitle,
  hasOffering,
  resolveOfferingSummaries,
} from '@/utils/propertyUtils';
import { shareContent } from '@/utils/share';
import { propertyService } from '@/services/propertyService';
import profileService from '@/services/profileService';
import ViewingService, { type ViewingRequest } from '@/services/viewingService';
import { MY_VIEWINGS_KEY } from '@/hooks/useUpcomingBookings';
import { formatArea, OfferingType, type Property } from '@homiio/shared-types';

import { PropertyDetailSkeleton } from '@/components/ui/skeletons/PropertyDetailSkeleton';

import { SleepArrangement } from '@/components/property/SleepArrangement';
import { LandlordSection } from '@/components/property/LandlordSection';
import { SindiSection } from '@/components/property/SindiSection';
import { FraudWarning } from '@/components/property/FraudWarning';
import { BasicInfoSection } from '@/components/property/BasicInfoSection';
import { ExternalContactSection } from '@/components/property/ExternalContactSection';
import { PropertyDetailsCard } from '@/components/property/PropertyDetailsCard';
import { PropertyFeatures } from '@/components/property/PropertyFeatures';
import { PricingDetails, hasPricingDetails } from '@/components/property/PricingDetails';
import { SaleDetailsSection } from '@/components/property/SaleDetailsSection';
import { MortgageCalculatorSection } from '@/components/property/MortgageCalculatorSection';
import { ExchangeSection } from '@/components/property/ExchangeSection';
import { ExchangeRequestBottomSheet } from '@/components/exchange/ExchangeRequestBottomSheet';
import { HouseRules } from '@/components/property/HouseRules';
import { LocationDisplay } from '@/components/property/LocationDisplay';
import { PropertyOverview } from '@/components/property/PropertyOverview';
import { NeighborhoodInfo } from '@/components/property/NeighborhoodInfo';
import { NearbyServicesSection } from '@/components/property/NearbyServicesSection';
import { AvailabilitySection } from '@/components/property/AvailabilitySection';
import { AmenitiesGrid } from '@/components/property/AmenitiesGrid';
import { CommunityNotesSection } from '@/components/property/CommunityNotesSection';
import { ReviewsSection } from '@/components/property/ReviewsSection';
import { PriceRangeSection } from '@/components/property/PriceRangeSection';
import { SimilarHomesSection } from '@/components/property/SimilarHomesSection';
import { DemandSignal } from '@/components/property/DemandSignal';
import { PropertyActionBar } from '@/components/property/PropertyActionBar';
import { Section, SECTION_GUTTER } from '@/components/property/Section';
import { BookingCard } from '@/components/property/BookingCard';

import { resolveBookingMode } from '@/utils/bookingMode';
import { hairline, spacing } from '@/constants/styles';

interface PropertyDetailViewModel {
  id: string;
  title: string;
  location: string;
  price: string;
  /** The price's spoken form ("1,200 euros per month"). */
  priceAccessibilityLabel: string;
  /** "Also available: …" line listing the OTHER offerings (empty when none). */
  alsoAvailable: string;
  bedrooms: number;
  bathrooms: number;
  size: number;
}

export default function PropertyDetailPage() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const formatting = useFormatting();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { oxyServices, activeSessionId } = useOxy();
  const { mode: rentalMode, browseMode } = useRentalMode();
  const { addProperty } = useRecentlyViewed();
  const propertyIdParam = typeof id === 'string' ? id : '';

  const { property: apiProperty, loading: isLoading, error } = useProperty(propertyIdParam);

  // Area price-insights drive the "Prices in this area" + "Similar homes"
  // block. We read it here (the child sections share the same React Query
  // cache key, so this does not duplicate the request) to decide whether to
  // render each section's flat wrapper — keeping us from leaving a bare
  // hairline divider when a section fails soft or has no comparables.
  const {
    insights: areaInsights,
    loading: areaInsightsLoading,
    error: areaInsightsError,
  } = useAreaInsights(propertyIdParam);

  const showPriceRangeSection =
    !areaInsightsError && (areaInsightsLoading || Boolean(areaInsights));
  const showSimilarHomesSection =
    !areaInsightsError && !areaInsightsLoading && (areaInsights?.comparables.length ?? 0) > 0;

  // "What's nearby" — same gating story as the price block: read the shared
  // React Query cache here (the child section reuses the same key, so this
  // doesn't duplicate the request) to decide whether to render the flat
  // wrapper, so a fail-soft/degraded-empty section never leaves a bare
  // hairline divider. The gate mirrors the section's own self-hide rule: hidden
  // on error, and hidden when a degraded (`partial`) payload found nothing
  // (treated as "unknown", not "nothing nearby").
  const {
    nearbyServices,
    loading: nearbyServicesLoading,
    error: nearbyServicesError,
  } = useNearbyServices(propertyIdParam);

  const nearbyHasContent =
    Boolean(nearbyServices) &&
    !(nearbyServices?.partial && !nearbyServices.categories.some((category) => category.present));
  const showNearbyServicesSection =
    !nearbyServicesError && (nearbyServicesLoading || nearbyHasContent);

  const trackedViewIdRef = useRef<string | null>(null);
  const [exchangeSheetVisible, setExchangeSheetVisible] = useState(false);

  const landlordOxyUserId = apiProperty?.oxyUserId;

  // The landlord's public profile and their other listings. Either failing
  // hides both — the section draws nothing rather than half a landlord.
  const landlordQuery = useQuery({
    queryKey: ['property', propertyIdParam, 'landlord', landlordOxyUserId],
    queryFn: async () => {
      const userId = landlordOxyUserId as string;
      const profile = await profileService.getPublicProfileByOxyUserId(userId);
      const { properties } = await propertyService.getOwnerProperties(userId, propertyIdParam);
      return { profile, properties };
    },
    enabled: Boolean(landlordOxyUserId),
  });
  const landlordProfile = landlordQuery.data?.profile ?? null;
  const ownerProperties: Property[] = landlordQuery.data?.properties ?? [];

  // Whether the user already booked a viewing here — read from the same list
  // (and cache entry) `/viewings` uses. A failure just leaves the banner off.
  const myViewingsQuery = useQuery<ViewingRequest[], Error>({
    queryKey: MY_VIEWINGS_KEY,
    queryFn: async () => {
      const response = await ViewingService.listMyViewingRequests({ page: 1, limit: 50 });
      return Array.isArray(response?.data) ? response.data : [];
    },
    enabled: Boolean(propertyIdParam && oxyServices && activeSessionId),
  });
  const hasActiveViewing = (myViewingsQuery.data ?? []).some(
    (v) => v.propertyId === propertyIdParam && ['pending', 'approved'].includes(v.status),
  );

  // Property view-model derived from the API payload.
  const property = useMemo<PropertyDetailViewModel | null>(() => {
    if (!apiProperty) return null;
    const propertyId = apiProperty.id || '';

    // Offering-aware headline price + location subtitle for the sticky header
    // and the right-column booking card. Centralised in `resolveHeadlinePrice`
    // so the screen, sticky header, and PropertyBookingWidget all share one
    // rule: the ACTIVE browse mode's priced block (long-term `/month`,
    // short-term `/night`, sale asking price, exchange "Free"). The unit is
    // fixed per block — never reinterpreted by mode.
    const { priceLabel, priceAccessibilityLabel, priceSubtitle } = resolveHeadlinePrice(
      apiProperty,
      browseMode,
      t,
      formatting,
    );

    // "Also available: By night · For sale" — the listing's OTHER offerings.
    const summaries = resolveOfferingSummaries(apiProperty, browseMode);
    const alsoAvailable =
      summaries.length > 0
        ? `${t('listing.offering.alsoAvailable', 'Also available')}: ${summaries
            .map((summary) => t(summary.i18nKey, summary.fallback))
            .join(' · ')}`
        : '';

    // The same title the listing's card shows, from the address's display names.
    const generatedTitle = getPropertyTitle(apiProperty);
    return {
      id: propertyId,
      title: generatedTitle,
      location: priceSubtitle,
      price: priceLabel,
      priceAccessibilityLabel,
      alsoAvailable,
      bedrooms: apiProperty.bedrooms || 0,
      bathrooms: apiProperty.bathrooms || 0,
      size: apiProperty.squareFootage || 0,
    };
  }, [apiProperty, browseMode, t, formatting]);

  // Track the view once per property shown.
  //
  // Left as an effect on purpose: recording a view belongs to the navigation
  // that opens a property, and that is ~25 call sites plus `PropertyCard`'s
  // `href`, deep links and the sidebar — not one handler this screen owns.
  useEffect(() => {
    if (!apiProperty?.id || apiProperty.id !== propertyIdParam) return;
    if (trackedViewIdRef.current === apiProperty.id) return;
    trackedViewIdRef.current = apiProperty.id;
    addProperty(apiProperty);
  }, [apiProperty, propertyIdParam, addProperty]);

  const handleContact = useCallback(async () => {
    if (apiProperty?.isExternal) {
      const external = apiProperty.externalContact;
      try {
        if (external?.phone) {
          await Linking.openURL(`tel:${external.phone}`);
          return;
        }
        if (external?.whatsapp) {
          const wa = external.whatsapp;
          const waUrl = /wa\.me\/|api\.whatsapp\.com/i.test(wa)
            ? wa
            : `https://wa.me/${wa.replace(/\D/g, '')}`;
          await Linking.openURL(waUrl);
          return;
        }
        if (external?.email) {
          await Linking.openURL(`mailto:${external.email}`);
          return;
        }
      } catch {
        toast.error(
          t('error.contact.openFailed', 'Could not open contact link') ||
            'Could not open contact link',
        );
        return;
      }
      if (!apiProperty.sourceUrl) {
        toast.error(
          t('error.source.noUrl', 'Source website URL not available') ||
            'Source website URL not available',
        );
        return;
      }
      try {
        await Linking.openURL(apiProperty.sourceUrl);
      } catch {
        toast.error(
          t('error.source.openFailed', 'Could not open the source website') ||
            'Could not open the source website',
        );
      }
      return;
    }
    if (!oxyServices || !activeSessionId) {
      toast.error(
        t('error.auth.required', 'Please sign in to contact the owner') ||
          'Please sign in to contact the owner',
      );
      openAccountDialog('signin');
      return;
    }
    // Homiio has no in-app messaging product, so "contact the owner" resolves to
    // the real enquiry surface: a viewing request for short-stay listings and a
    // tenant application otherwise. Never route to a non-existent chat screen.
    const targetId = apiProperty?.id ?? property?.id;
    if (!targetId) return;
    if (rentalMode === 'vacation') {
      router.push(`/properties/${targetId}/book-viewing`);
    } else {
      router.push(`/properties/${targetId}/apply`);
    }
  }, [apiProperty, oxyServices, activeSessionId, t, router, rentalMode, property?.id]);

  /**
   * Call the advertiser — only ever a contact the advertiser published on the
   * listing itself (`externalContact`).
   *
   * A Homiio listing has no owner-published phone, so there is nothing to call:
   * the number this used to dial was `personalProfile.rentalHistory[0]
   * .landlordContact.phone` — the owner's OWN former landlord, a third party's
   * number published on somebody else's say-so (ADR 0003 §4.5).
   */
  const handleCall = useCallback(async () => {
    const phone = apiProperty?.isExternal ? apiProperty.externalContact?.phone : undefined;
    const whatsapp = apiProperty?.isExternal ? apiProperty.externalContact?.whatsapp : undefined;
    if (!phone && !whatsapp) {
      toast.error(
        t('error.contact.noPhone', 'No phone number available for this listing') ||
          'No phone number available for this listing',
      );
      return;
    }
    try {
      if (phone) {
        await Linking.openURL(`tel:${phone}`);
      } else if (whatsapp) {
        const waUrl = /wa\.me\/|api\.whatsapp\.com/i.test(whatsapp)
          ? whatsapp
          : `https://wa.me/${whatsapp.replace(/\D/g, '')}`;
        await Linking.openURL(waUrl);
      }
    } catch {
      toast.error(
        t('error.contact.openFailed', 'Could not open contact link') ||
          'Could not open contact link',
      );
    }
  }, [t, apiProperty]);

  // A public-housing listing is applied for on the programme's own page: the
  // listing's source, never a guessed authority website.
  const sourceUrl = apiProperty?.sourceUrl;
  const handlePublicHousingApply = useCallback(async () => {
    if (!sourceUrl) {
      toast.error(
        t('error.source.noUrl', 'Source website URL not available') ||
          'Source website URL not available',
      );
      return;
    }
    try {
      await Linking.openURL(sourceUrl);
    } catch {
      toast.error(
        t('error.source.openFailed', 'Could not open the source website') ||
          'Could not open the source website',
      );
    }
  }, [sourceUrl, t]);

  const handleShare = useCallback(async () => {
    if (!property) return;
    const propertyUrl = `https://homiio.com/properties/${property.id}`;
    const details = `${property.title}\n\n${property.location}\n${property.price}\n${property.bedrooms} Bedrooms\n${property.bathrooms} Bathrooms\n${property.size}m²\n\n${propertyUrl}`;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // The clipboard fallback copies the full details (not just the URL), matching
    // the share-sheet message.
    const outcome = await shareContent({
      title: 'Share Property',
      message: details,
      url: propertyUrl,
      copyText: details,
    });
    if (outcome === 'copied') {
      toast.success('Property details copied to clipboard');
    } else if (outcome === 'failed') {
      toast.error('Failed to share property');
    }
  }, [property]);

  // Sale-listing primary CTA: open the existing viewing-request flow.
  const handleRequestViewing = useCallback(() => {
    const targetId = apiProperty?.id;
    if (targetId) {
      router.push(`/properties/${targetId}/book-viewing`);
    }
  }, [apiProperty, router]);

  // Exchange-listing primary CTA: open the request-exchange sheet. Routes to
  // sign-in first when unauthenticated, matching the other gated actions.
  const handleRequestExchange = useCallback(() => {
    if (!oxyServices || !activeSessionId) {
      openAccountDialog('signin');
      return;
    }
    setExchangeSheetVisible(true);
  }, [oxyServices, activeSessionId]);

  // Photos cover-first with captions; the grid and the fullscreen gallery read
  // the SAME list, so a tapped tile opens that photo.
  const photos = useMemo(
    () => getPropertyPhotos(apiProperty?.images, apiProperty?.coverImageIndex, 'large'),
    [apiProperty?.images, apiProperty?.coverImageIndex],
  );
  const galleryRef = useRef<ZoomableMediaGalleryHandle>(null);
  const openGallery = useCallback(
    (index: number) => {
      galleryRef.current?.open(
        photos.map((photo) => ({ uri: photo.source, alt: photo.alt })),
        index,
      );
    },
    [photos],
  );

  // The header's rating is the address's real review aggregate — the same
  // source the reviews section reads — and absent without reviews.
  const { ratingSummary } = useAddressReviews(apiProperty);

  const { isPropertySaved, savePropertyToFolder, unsaveProperty } = useSavedPropertiesContext();
  const isSaved = apiProperty?.id ? isPropertySaved(String(apiProperty.id)) : false;
  const handleToggleSaved = useCallback(() => {
    const targetId = apiProperty?.id ? String(apiProperty.id) : '';
    if (!targetId) return;
    // The context toasts the outcome and rolls back on failure.
    const action = isSaved
      ? unsaveProperty(targetId)
      : savePropertyToFolder(targetId, null, apiProperty ?? undefined);
    action.catch(() => undefined);
  }, [apiProperty, isSaved, savePropertyToFolder, unsaveProperty]);

  const bookingMode = apiProperty
    ? resolveBookingMode(apiProperty as Property, rentalMode, browseMode)
    : 'none';
  // The phone booking bar and the inline booking card share one selection.
  // Both are hidden from `lg` up, where the rail's booking widget takes over.
  const stay = useStayBooking(apiProperty, { enabled: bookingMode === 'vacation' });
  const showBookingBar = bookingMode === 'vacation' && stay.bookable;

  if (isLoading) {
    return (
      <Screen
        documentScroll
        header={
          <PageHeader
            placement="overlap"
            leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
            onBack={router.canGoBack() ? router.back : undefined}
            backLabel={t('goBack')}
          />
        }
      >
        <ScreenScrollView>
          <PropertyDetailSkeleton />
        </ScreenScrollView>
      </Screen>
    );
  }

  if (error || !property) {
    return (
      <Screen
        documentScroll
        header={
          <PageHeader
            title={t('property.error', 'Error') || 'Error'}
            titleAlign="center"
            leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
            onBack={router.canGoBack() ? router.back : undefined}
            backLabel={t('goBack')}
          />
        }
      >
        <ScreenScrollView>
          <ErrorState
            icon={RiHomeLine}
            title={t('property.notFound', 'Property not found') || 'Property not found'}
            description={
              t('property.notFoundHelp', 'It may have been removed or the link is broken.') ||
              'It may have been removed or the link is broken.'
            }
            retryLabel={t('goBack', 'Go back') || 'Go back'}
            onRetry={() => router.back()}
          />
        </ScreenScrollView>
      </Screen>
    );
  }

  // Whether this listing can be booked as a short-stay (Airbnb-style) — it
  // carries the SHORT_TERM_RENT offering. This capability is a property of the
  // listing itself, independent of the currently-selected rentalMode toggle.
  const isVacationRentable = Boolean(
    apiProperty && hasOffering(apiProperty, OfferingType.SHORT_TERM_RENT),
  );

  // Whether this listing is (also) for sale. Drives the Sale Details + Mortgage
  // sections below. Both additionally require the `sale` sub-payload to render,
  // so a sale listing with no stored sale block never leaves a bare divider.
  const isSaleListing = Boolean(apiProperty && hasOffering(apiProperty, OfferingType.SALE));
  const saleData = isSaleListing ? apiProperty?.sale : undefined;

  // Whether this listing is open to home exchange (swap / free hosting). Drives
  // the Exchange section + the action-bar CTA. Like sale, the section also
  // requires the `exchange` sub-payload to render, so an exchange listing with
  // no stored exchange block never leaves a bare divider.
  const isExchangeListing = Boolean(apiProperty && hasOffering(apiProperty, OfferingType.EXCHANGE));
  const exchangeData = isExchangeListing ? apiProperty?.exchange : undefined;

  // On wide screens the booking/apply card is rendered in the app shell's
  // right column (RightBar → PropertyBookingWidget), so the inline card is
  // hidden from `lg` up (where the RightBar shows). The screen stays
  // single-column either way. `resolveBookingMode` is the ONE branching source
  // shared with BookingCard — the mobile inline path renders the SAME card.
  const showInlineBookingCard = bookingMode !== 'none' || Boolean(apiProperty?.isExternal);

  const headerFacts = [
    apiProperty?.type ? t(`properties.titles.types.${apiProperty.type}`, { defaultValue: '' }) : '',
    property.bedrooms ? t('listing.card.beds', { count: property.bedrooms }) : '',
    property.bathrooms ? t('listing.card.baths', { count: property.bathrooms }) : '',
    property.size > 0
      ? formatArea(property.size, 'sqm', formatting.locale, { labels: formatting.areaUnitLabels })
      : '',
  ].filter(Boolean);
  const hasRating = ratingSummary.totalReviews > 0;

  const listingHeader = (
    <View style={styles.listingHeader}>
      <ListingHeader
        title={property.title}
        subtitle={headerFacts}
        rating={hasRating ? ratingSummary.averageRating : undefined}
        reviewsLabel={
          hasRating ? t('property.reviews.total', { count: ratingSummary.totalReviews }) : undefined
        }
        location={getPropertyLocationLabel(apiProperty ?? undefined) || undefined}
        actions={
          <>
            <ListingHeaderAction
              icon={RiShare2Line}
              label={t('common.share')}
              onPress={handleShare}
            />
            <ListingHeaderAction
              icon={isSaved ? RiHeartFill : RiHeartLine}
              label={t('common.save')}
              pressed={isSaved}
              onPress={handleToggleSaved}
            />
          </>
        }
      />
    </View>
  );
  const photoGrid =
    photos.length > 0 ? (
      <View className="md:p-6">
        <ListingPhotoGrid
          photos={photos}
          layout="auto"
          onPressPhoto={openGallery}
          onShowAll={() => openGallery(0)}
          showAllLabel={t('property.photos.showAll')}
          accessibilityLabel={t('property.photos.label')}
          photoLabel={(photo, position, total) =>
            photo.alt
              ? t('property.photos.namedPhotoOf', { name: photo.alt, position, total })
              : t('property.photos.photoOf', { position, total })
          }
        />
      </View>
    ) : null;

  const showSleepArrangement = rentalMode === 'vacation' && isVacationRentable;

  const actionBar = (
    <PropertyActionBar
      property={apiProperty}
      price={property.price}
      priceAccessibilityLabel={property.priceAccessibilityLabel}
      canCall={Boolean(
        apiProperty?.isExternal &&
          (apiProperty.externalContact?.phone || apiProperty.externalContact?.whatsapp),
      )}
      onContact={handleContact}
      onCall={handleCall}
      onApplyPublic={handlePublicHousingApply}
      isSaleListing={isSaleListing}
      onRequestViewing={handleRequestViewing}
      isExchangeListing={isExchangeListing}
      onRequestExchange={handleRequestExchange}
    />
  );

  return (
    <Screen
      documentScroll
      header={
        <PageHeader
          title={property.title}
          subtitle={property.price}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          onBack={router.canGoBack() ? router.back : undefined}
          backLabel={t('goBack')}
          actions={
            <ButtonGroup>
              {landlordOxyUserId ? (
                <ButtonGroupItem
                  iconOnly
                  leadingIcon={RiAccountCircleLine}
                  onPress={() => router.push(`/roommates/${landlordOxyUserId}`)}
                  accessibilityLabel={t('property.host.openProfile')}
                />
              ) : null}
              <ButtonGroupItem
                iconOnly
                leadingIcon={RiCalendarLine}
                selected={hasActiveViewing}
                onPress={() => router.push('/viewings')}
                accessibilityLabel={t('viewings.title')}
              />
            </ButtonGroup>
          }
          placement="overlap"
          titleReveal="onScroll"
        />
      }
      bottomBar={
        showBookingBar ? (
          <>
            <View className="lg:hidden">
              <BookingBar
                price={stay.price}
                priceUnit={stay.priceUnit}
                priceAccessibilityLabel={stay.priceAccessibilityLabel}
                dates={stay.datesSummary ?? t('search.summary.addDates')}
                onPressDates={() => stay.openDates('checkIn')}
                reserveLabel={
                  !stay.range
                    ? t('booking.widget.checkAvailability')
                    : stay.instantBook
                      ? t('property.cta.reserve')
                      : t('booking.widget.requestToBook')
                }
                onReserve={stay.reserve}
                loading={stay.reserving}
              />
            </View>
            <View className="hidden lg:flex">{actionBar}</View>
          </>
        ) : (
          actionBar
        )
      }
    >
      <ScreenScrollView contentContainerStyle={styles.content}>
        {photoGrid}
        {listingHeader}

        <View style={styles.infoContainer}>
          {apiProperty ? (
            <View style={styles.demandRow}>
              <DemandSignal propertyId={property.id} createdAt={apiProperty.createdAt} />
            </View>
          ) : null}

          <View className="border-border" style={[styles.section, styles.divider]}>
            <BasicInfoSection
              property={apiProperty}
              mode={rentalMode}
              hasActiveViewing={hasActiveViewing}
              onViewingsPress={() => router.push('/viewings')}
            />
            <ExternalContactSection property={apiProperty} />
            {property.alsoAvailable ? (
              <View style={styles.alsoAvailableRow}>
                <RiShapesLine width={14} height={14} fill={colors.textSecondary} />
                <BloomText className="text-[13px] text-muted-foreground">
                  {property.alsoAvailable}
                </BloomText>
              </View>
            ) : null}
          </View>

          {showInlineBookingCard && apiProperty ? (
            <View className="border-border lg:hidden" style={[styles.section, styles.divider]}>
              <Section>
                <BookingCard
                  property={apiProperty as Property}
                  stay={showBookingBar ? stay : undefined}
                />
              </Section>
            </View>
          ) : null}

          <View className="border-border" style={[styles.section, styles.divider]}>
            <PropertyDetailsCard property={apiProperty} />
          </View>

          <View className="border-border" style={[styles.section, styles.divider]}>
            <PropertyFeatures property={apiProperty} />
          </View>

          {showSleepArrangement ? (
            <View className="border-border" style={[styles.section, styles.divider]}>
              <SleepArrangement property={apiProperty as Property} />
            </View>
          ) : null}

          {hasPricingDetails(apiProperty, rentalMode) ? (
            <View className="border-border" style={[styles.section, styles.divider]}>
              <PricingDetails property={apiProperty} mode={rentalMode} />
            </View>
          ) : null}

          {/* Sale details + mortgage calculator — only for sale listings that
              carry a sale block (gated together so neither leaves a bare
              hairline divider behind). */}
          {saleData ? (
            <View className="border-border" style={[styles.section, styles.divider]}>
              <SaleDetailsSection sale={saleData} />
            </View>
          ) : null}

          {saleData ? (
            <View className="border-border" style={[styles.section, styles.divider]}>
              <MortgageCalculatorSection salePrice={saleData.price} currency={saleData.currency} />
            </View>
          ) : null}

          {/* Home exchange — only for exchange listings that carry an exchange
              block. Gated like the sale section so it never leaves a bare
              hairline divider. */}
          {exchangeData ? (
            <View className="border-border" style={[styles.section, styles.divider]}>
              <ExchangeSection
                exchange={exchangeData}
                /* An EXTERNAL listing keeps its exchange terms on show and
                   loses the live CTA: the swap would be arranged with a person
                   Homiio has no relationship with, on a listing copied from
                   somewhere else. `PropertyActionBar` and `BookingCard` have
                   always branched on `isExternal` first; this section was the
                   one that did not. */
                onRequestExchange={apiProperty?.isExternal ? undefined : handleRequestExchange}
              />
            </View>
          ) : null}

          <View className="border-border" style={[styles.section, styles.divider]}>
            <HouseRules property={apiProperty} />
          </View>

          <View className="border-border" style={[styles.section, styles.divider]}>
            <LocationDisplay property={apiProperty as Property} />
          </View>

          <View className="border-border" style={[styles.section, styles.divider]}>
            <PropertyOverview property={apiProperty} />
          </View>

          <View className="border-border" style={[styles.section, styles.divider]}>
            <NeighborhoodInfo property={apiProperty} />
          </View>

          {/* What's nearby — everyday services (pharmacy, school, transit, …)
              near this listing. Gated so a fail-soft / degraded-empty section
              never leaves a bare hairline divider behind. */}
          {showNearbyServicesSection ? (
            <View className="border-border" style={[styles.section, styles.divider]}>
              <NearbyServicesSection propertyId={property.id} />
            </View>
          ) : null}

          <View className="border-border" style={[styles.section, styles.divider]}>
            <AvailabilitySection property={apiProperty} />
          </View>

          <View className="border-border" style={[styles.section, styles.divider]}>
            <AmenitiesGrid property={apiProperty as { amenities?: string[] | null }} />
          </View>

          {/* Community Notes — community-verified notes about the building —
              shown on every listing. */}
          <View className="border-border" style={[styles.section, styles.divider]}>
            <CommunityNotesSection property={apiProperty as Property} variant="preview" />
          </View>

          {/* Reviews of the ADDRESS — past residents on the place itself, on
              every offering: they outlive the advertisement (ADR 0001), so a
              home for rent, for sale or to swap shows the same ones. Reviews
              and Community Notes are distinct features that coexist. */}
          <View className="border-border" style={[styles.section, styles.divider]}>
            <ReviewsSection property={apiProperty as Property} />
          </View>

          {/* Area context: how this listing's price compares to similar
              homes nearby, plus a carousel of those comparables. Grouped
              between Community Notes and the landlord's own listings. Each
              wrapper is gated so a fail-soft/empty section never leaves a
              bare hairline divider behind. */}
          {showPriceRangeSection ? (
            <View className="border-border" style={[styles.section, styles.divider]}>
              <PriceRangeSection propertyId={property.id} bedrooms={property.bedrooms} />
            </View>
          ) : null}

          {showSimilarHomesSection ? (
            <View
              className="border-border"
              style={[styles.section, styles.divider, { paddingHorizontal: SECTION_GUTTER }]}
            >
              <SimilarHomesSection propertyId={property.id} />
            </View>
          ) : null}

          {apiProperty ? (
            <View className="border-border" style={[styles.section, styles.divider]}>
              <LandlordSection
                property={apiProperty}
                landlordProfile={landlordProfile}
                ownerProperties={ownerProperties}
                onApplyPublic={handlePublicHousingApply}
              />
            </View>
          ) : null}

          {apiProperty ? (
            <View className="border-border" style={[styles.section, styles.divider]}>
              <SindiSection property={apiProperty} />
            </View>
          ) : null}
          <View className="border-border" style={[styles.section, styles.divider]}>
            <FraudWarning text={t('property.fraudWarning')} />
          </View>
        </View>
      </ScreenScrollView>
      {stay.dialog}

      <ZoomableMediaGallery ref={galleryRef} indicatorVariant="thumbnails" />

      {/* Mounted on-demand: the request flow (and its own-properties query) only
          spins up once the authed user opens the sheet, never on idle views. */}
      {exchangeData && apiProperty && exchangeSheetVisible ? (
        <ExchangeRequestBottomSheet
          property={apiProperty as Property}
          visible={exchangeSheetVisible}
          onClose={() => setExchangeSheetVisible(false)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing['7xl'] },
  listingHeader: {
    paddingHorizontal: SECTION_GUTTER,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  // Single-column content. The page columns (content + widgets) are owned
  // by the app shell (app/_layout.tsx: mainContentWrapper + RightBar), so
  // this screen only fills the content column. It's full-bleed (no
  // horizontal padding) so horizontally-scrolling section bodies can run
  // edge-to-edge; the horizontal gutter lives per-section (Section
  // primitive + section roots, sourced from SECTION_GUTTER) instead.
  infoContainer: {
    width: '100%',
  },
  // Flat section rhythm: every block gets the same vertical breathing
  // room (no per-component margins) and is separated by a single
  // hairline. Content sits directly on the page — no cards. Horizontal
  // gutter is added per-section, not here.
  section: {
    paddingVertical: spacing.xl,
  },
  // Demand signal sits just under the photos, sharing the section gutter.
  demandRow: {
    paddingHorizontal: SECTION_GUTTER,
    paddingBottom: spacing.xl,
  },
  // "Also available" line under the headline price, sharing the section gutter.
  alsoAvailableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: SECTION_GUTTER,
    marginTop: spacing.md,
  },
  divider: {
    borderTopWidth: hairline.width,
  },
});
