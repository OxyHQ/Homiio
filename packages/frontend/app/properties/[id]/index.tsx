/**
 * Property detail screen — Airbnb-2026 inspired layout.
 *
 * Architecture:
 *  - Hero PhotoGrid (1+4 on web/tablet, carousel on phone).
 *  - Two-column layout on desktop: left = sections, right = sticky
 *    booking/apply card.
 *  - On scroll past the photo grid, a slim sticky breadcrumb header
 *    (StickyPropertyHeader) appears with title + price + CTA.
 *  - Sections are flat (no cards/shadows): shared Bloom Typography, a
 *    consistent vertical rhythm (`styles.section`), and a single
 *    hairline divider between blocks. Content sits directly on the page
 *    background and aligns to one gutter.
 *  - Action bar (footer): existing PropertyActionBar reused.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Platform,
  Pressable,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { toast } from '@/lib/sonner';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';

import { useOxy, showSignInModal } from '@oxyhq/services';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { Header } from '@/components/Header';
import { SaveButton } from '@/components/SaveButton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useLayoutScroll } from '@/context/LayoutScrollContext';
import { useAreaInsights, useNearbyServices, useProperty } from '@/hooks';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useRentalMode } from '@/context/RentalModeContext';
import { useIsRightBarVisible } from '@/hooks/useOptimizedMediaQuery';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { resolveHeadlinePrice } from '@/utils/propertyPricing';
import { hasOffering, resolveOfferingSummaries } from '@/utils/propertyUtils';
import { propertyService } from '@/services/propertyService';
import profileService, { type Profile } from '@/services/profileService';
import ViewingService from '@/services/viewingService';
import { OfferingType, PropertyType, type Property, type PropertyImage } from '@homiio/shared-types';

import { PropertyDetailSkeleton } from '@/components/ui/skeletons/PropertyDetailSkeleton';

import { PhotoGrid } from '@/components/property/PhotoGrid';
import { HeaderSection } from '@/components/property/HeaderSection';
import { HostStatsCard } from '@/components/property/HostStatsCard';
import { SleepArrangement } from '@/components/property/SleepArrangement';
import { LandlordSection } from '@/components/property/LandlordSection';
import { SindiSection } from '@/components/property/SindiSection';
import { FraudWarning } from '@/components/property/FraudWarning';
import { BasicInfoSection } from '@/components/property/BasicInfoSection';
import { PropertyDetailsCard } from '@/components/property/PropertyDetailsCard';
import { PropertyFeatures } from '@/components/property/PropertyFeatures';
import { PricingDetails } from '@/components/property/PricingDetails';
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
import { AmenitiesSection } from '@/components/property/AmenitiesSection';
import { CommunityNotesSection } from '@/components/property/CommunityNotesSection';
import { ReviewsSection } from '@/components/property/ReviewsSection';
import { PriceRangeSection } from '@/components/property/PriceRangeSection';
import { SimilarHomesSection } from '@/components/property/SimilarHomesSection';
import { DemandSignal } from '@/components/property/DemandSignal';
import { PropertyActionBar } from '@/components/property/PropertyActionBar';
import { StickyPropertyHeader } from '@/components/property/StickyPropertyHeader';
import { Section, SECTION_GUTTER } from '@/components/property/Section';
import { BookingCard } from '@/components/property/BookingCard';

import { resolveBookingMode } from '@/utils/bookingMode';
import { colors } from '@/styles/colors';
import { hairline, spacing } from '@/constants/styles';

interface PropertyDetailViewModel {
  id: string;
  title: string;
  location: string;
  price: string;
  /** "Also available: …" line listing the OTHER offerings (empty when none). */
  alsoAvailable: string;
  bedrooms: number;
  bathrooms: number;
  size: number;
  images: string[] | PropertyImage[];
}

const STICKY_HEADER_THRESHOLD = 480;

export default function PropertyDetailPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { oxyServices, activeSessionId } = useOxy();
  const layoutScrollContext = useLayoutScroll();
  const { mode: rentalMode, browseMode } = useRentalMode();
  const { addProperty } = useRecentlyViewed();
  // On wide screens the booking/apply card lives in the app shell's right
  // column (RightBar → PropertyBookingWidget). When the RightBar is hidden
  // (mobile/narrow), the screen inlines the card instead — gated below.
  const isRightBarVisible = useIsRightBarVisible();

  const propertyIdParam = typeof id === 'string' ? id : '';

  const {
    property: apiProperty,
    loading: isLoading,
    error,
    loadProperty,
  } = useProperty(propertyIdParam);

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
    !areaInsightsError &&
    !areaInsightsLoading &&
    (areaInsights?.comparables.length ?? 0) > 0;

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
    !(
      nearbyServices?.partial &&
      !nearbyServices.categories.some((category) => category.present)
    );
  const showNearbyServicesSection =
    !nearbyServicesError && (nearbyServicesLoading || nearbyHasContent);

  const hasViewedRef = useRef(false);
  const [hasActiveViewing, setHasActiveViewing] = useState(false);
  const [landlordProfile, setLandlordProfile] = useState<Profile | null>(null);
  const [ownerProperties, setOwnerProperties] = useState<Property[]>([]);
  const [stickyHeaderVisible, setStickyHeaderVisible] = useState(false);
  const [exchangeSheetVisible, setExchangeSheetVisible] = useState(false);

  // Normalize landlord id (handles legacy MongoDB $oid envelopes).
  const landlordProfileId = useMemo<string | undefined>(() => {
    const profileId = apiProperty?.profileId;
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
  }, [apiProperty?.profileId]);

  // Fetch landlord profile + their other listings.
  useEffect(() => {
    const fetchLandlordData = async () => {
      if (!landlordProfileId || !oxyServices || !activeSessionId) return;
      try {
        const profile = await profileService.getProfileById(landlordProfileId);
        setLandlordProfile(profile);
        const { properties } = await propertyService.getOwnerProperties(
          landlordProfileId,
          typeof id === 'string' ? id : '',
        );
        setOwnerProperties(properties);
      } catch {
        setLandlordProfile(null);
        setOwnerProperties([]);
      }
    };
    fetchLandlordData();
  }, [landlordProfileId, oxyServices, activeSessionId, id]);

  // Property view-model derived from the API payload.
  const property = useMemo<PropertyDetailViewModel | null>(() => {
    if (!apiProperty) return null;
    const propertyId = apiProperty._id || apiProperty.id || '';

    // Offering-aware headline price + location subtitle for the sticky header
    // and the right-column booking card. Centralised in `resolveHeadlinePrice`
    // so the screen, sticky header, and PropertyBookingWidget all share one
    // rule: the ACTIVE browse mode's priced block (long-term `/month`,
    // short-term `/night`, sale asking price, exchange "Free"). The unit is
    // fixed per block — never reinterpreted by mode.
    const { priceLabel, priceSubtitle } = resolveHeadlinePrice(
      apiProperty,
      browseMode,
      t,
    );

    // "Also available: By night · For sale" — the listing's OTHER offerings.
    const summaries = resolveOfferingSummaries(apiProperty, browseMode);
    const alsoAvailable =
      summaries.length > 0
        ? `${t('listing.offering.alsoAvailable', 'Also available')}: ${summaries
            .map((summary) => t(summary.i18nKey, summary.fallback))
            .join(' · ')}`
        : '';

    const generatedTitle = generatePropertyTitle({
      type: Object.values(PropertyType).includes(apiProperty.type as PropertyType)
        ? (apiProperty.type as PropertyType)
        : PropertyType.APARTMENT,
      address: apiProperty.address,
      bedrooms: apiProperty.bedrooms,
      bathrooms: apiProperty.bathrooms,
    });
    return {
      id: propertyId,
      title: generatedTitle,
      location: priceSubtitle,
      price: priceLabel,
      alsoAvailable,
      bedrooms: apiProperty.bedrooms || 0,
      bathrooms: apiProperty.bathrooms || 0,
      size: apiProperty.squareFootage || 0,
      images: apiProperty.images || [],
    };
  }, [apiProperty, browseMode, t]);

  // Track property view once per page load.
  useEffect(() => {
    if (apiProperty && !hasViewedRef.current) {
      const propertyId = apiProperty._id || apiProperty.id;
      const currentId = typeof id === 'string' ? id : undefined;
      if (propertyId && currentId && propertyId === currentId) {
        hasViewedRef.current = true;
        addProperty(apiProperty);
      }
    }
  }, [apiProperty, id, addProperty]);

  // Reset view tracker on id change.
  useEffect(() => {
    hasViewedRef.current = false;
  }, [id]);

  // Trigger property fetch on id change.
  useEffect(() => {
    if (id) loadProperty();
  }, [id, loadProperty]);

  // Check whether the user already booked a viewing.
  useEffect(() => {
    const checkActiveViewing = async () => {
      if (!id || !oxyServices || !activeSessionId) return;
      try {
        const response = await ViewingService.listMyViewingRequests({
          page: 1,
          limit: 50,
        });
        const viewings = Array.isArray(response?.data) ? response.data : [];
        const hasActive = viewings.some(
          (v) =>
            v.propertyId === id &&
            ['pending', 'approved'].includes(v.status),
        );
        setHasActiveViewing(hasActive);
      } catch {
        /* swallow — banner just stays off */
      }
    };
    checkActiveViewing();
  }, [id, oxyServices, activeSessionId]);

  const handleContact = useCallback(() => {
    if (apiProperty?.isExternal) {
      if (!apiProperty.sourceUrl) {
        toast.error(
          t('error.source.noUrl', 'Source website URL not available') ||
            'Source website URL not available',
        );
        return;
      }
      router.push(`/browser?url=${encodeURIComponent(apiProperty.sourceUrl)}`);
      return;
    }
    if (!oxyServices || !activeSessionId) {
      toast.error(
        t('error.auth.required', 'Please sign in to contact the owner') ||
          'Please sign in to contact the owner',
      );
      showSignInModal();
      return;
    }
    router.push(`/chat/${property?.id}`);
  }, [apiProperty, oxyServices, activeSessionId, t, router, property?.id]);

  const handleCall = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      toast.error(
        t('error.auth.required', 'Please sign in to call the owner') ||
          'Please sign in to call the owner',
      );
      showSignInModal();
      return;
    }
    if (!landlordProfile) {
      toast.error(
        t('error.profile.notFound', 'Owner profile not found') ||
          'Owner profile not found',
      );
      return;
    }
    let phoneNumber: string | undefined;
    let allowCalls = false;
    if (landlordProfile.personalProfile) {
      const latestRental = landlordProfile.personalProfile.rentalHistory?.[0];
      phoneNumber = latestRental?.landlordContact?.phone;
      allowCalls =
        landlordProfile.personalProfile.settings?.privacy?.showContactInfo ??
        false;
    } else if (landlordProfile.agencyProfile) {
      phoneNumber = landlordProfile.agencyProfile.businessDetails?.licenseNumber;
      allowCalls = true;
    } else if (landlordProfile.businessProfile) {
      phoneNumber = landlordProfile.businessProfile.businessDetails?.licenseNumber;
      allowCalls = true;
    } else if (landlordProfile.cooperativeProfile) {
      phoneNumber = landlordProfile.cooperativeProfile.legalName;
      allowCalls = true;
    }
    if (!allowCalls) {
      toast.error(
        t('error.call.notAllowed', 'Owner does not accept calls') ||
          'Owner does not accept calls',
      );
      return;
    }
    if (!phoneNumber) {
      toast.error(
        t('error.call.noPhone', 'No phone number available') ||
          'No phone number available',
      );
      return;
    }
    try {
      await Linking.openURL(`tel:${phoneNumber}`);
    } catch {
      toast.error(
        t('error.call.failed', 'Could not open phone dialer') ||
          'Could not open phone dialer',
      );
    }
  }, [oxyServices, activeSessionId, landlordProfile, t]);

  const handlePublicHousingApply = useCallback(() => {
    const state = (apiProperty?.address?.state || '').toLowerCase();
    const stateWebsites: Record<string, string> = {
      california:
        'https://www.hcd.ca.gov/grants-funding/active-funding/multifamily-housing-program',
      'new york': 'https://www.nyshcr.org/',
      texas: 'https://www.tdhca.state.tx.us/',
      florida: 'https://www.floridahousing.org/',
    };
    const websiteUrl =
      stateWebsites[state] || 'https://www.hud.gov/topics/rental_assistance/phprog';
    router.push(`/browser?url=${encodeURIComponent(websiteUrl)}`);
  }, [apiProperty?.address?.state, router]);

  const handleShare = useCallback(async () => {
    if (!property) return;
    const propertyUrl = `https://homiio.com/properties/${property.id}`;
    const details = `${property.title}\n\n${property.location}\n${property.price}\n${property.bedrooms} Bedrooms\n${property.bathrooms} Bathrooms\n${property.size}m²\n\n${propertyUrl}`;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await Share.share({
        message: details,
        url: propertyUrl,
        title: 'Share Property',
      });
    } catch {
      try {
        await Clipboard.setStringAsync(details);
        toast.success('Property details copied to clipboard');
      } catch {
        toast.error('Failed to share property');
      }
    }
  }, [property]);

  const handleCtaPress = useCallback(() => {
    if (apiProperty?.housingType === 'public') {
      handlePublicHousingApply();
      return;
    }
    if (rentalMode === 'vacation') {
      handleContact();
      return;
    }
    if (apiProperty?._id || apiProperty?.id) {
      router.push(`/properties/${apiProperty._id ?? apiProperty.id}/apply`);
    }
  }, [apiProperty, rentalMode, router, handleContact, handlePublicHousingApply]);

  // Sale-listing primary CTA: open the existing viewing-request flow.
  const handleRequestViewing = useCallback(() => {
    const targetId = apiProperty?._id ?? apiProperty?.id;
    if (targetId) {
      router.push(`/properties/${targetId}/book-viewing`);
    }
  }, [apiProperty, router]);

  // Exchange-listing primary CTA: open the request-exchange sheet. Routes to
  // sign-in first when unauthenticated, matching the other gated actions.
  const handleRequestExchange = useCallback(() => {
    if (!oxyServices || !activeSessionId) {
      showSignInModal();
      return;
    }
    setExchangeSheetVisible(true);
  }, [oxyServices, activeSessionId]);

  // Sticky header trigger driven by scrollY. Uses Reanimated SharedValue
  // so the value stays UI-thread native; React state is toggled via runOnJS
  // only when crossing the threshold.
  const localScrollY = useSharedValue(0);
  const scrollY = layoutScrollContext?.scrollY ?? localScrollY;

  const handleScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
      runOnJS(setStickyHeaderVisible)(event.contentOffset.y > STICKY_HEADER_THRESHOLD);
    },
  });

  if (isLoading) {
    return <PropertyDetailSkeleton />;
  }

  if (error || !property) {
    return (
      <View style={styles.errorRoot}>
        <Header
          options={{
            showBackButton: true,
            title: t('property.error', 'Error') || 'Error',
            titlePosition: 'center',
          }}
        />
        <SafeAreaView style={styles.errorBody} edges={['bottom']}>
          <ErrorState
            icon="home-outline"
            title={t('property.notFound', 'Property not found') || 'Property not found'}
            description={
              t(
                'property.notFoundHelp',
                'It may have been removed or the link is broken.',
              ) || 'It may have been removed or the link is broken.'
            }
            retryLabel={t('goBack', 'Go back') || 'Go back'}
            onRetry={() => router.back()}
          />
        </SafeAreaView>
      </View>
    );
  }

  // Whether this listing can be booked as a short-stay (Airbnb-style) — it
  // carries the SHORT_TERM_RENT offering. This capability is a property of the
  // listing itself, independent of the currently-selected rentalMode toggle, so
  // it also decides Reviews (vacation) vs Community Notes (long-term) below.
  const isVacationRentable = Boolean(
    apiProperty && hasOffering(apiProperty, OfferingType.SHORT_TERM_RENT),
  );

  // Whether this listing is (also) for sale. Drives the Sale Details + Mortgage
  // sections below. Both additionally require the `sale` sub-payload to render,
  // so a sale listing with no stored sale block never leaves a bare divider.
  const isSaleListing = Boolean(
    apiProperty && hasOffering(apiProperty, OfferingType.SALE),
  );
  const saleData = isSaleListing ? apiProperty?.sale : undefined;

  // Whether this listing is open to home exchange (swap / free hosting). Drives
  // the Exchange section + the action-bar CTA. Like sale, the section also
  // requires the `exchange` sub-payload to render, so an exchange listing with
  // no stored exchange block never leaves a bare divider.
  const isExchangeListing = Boolean(
    apiProperty && hasOffering(apiProperty, OfferingType.EXCHANGE),
  );
  const exchangeData = isExchangeListing ? apiProperty?.exchange : undefined;

  // On wide screens the booking/apply card is rendered in the app shell's
  // right column (RightBar → PropertyBookingWidget), so the inline card only
  // shows when the RightBar is hidden (mobile/narrow). The screen stays
  // single-column either way. `resolveBookingMode` is the ONE branching source
  // shared with BookingCard — the mobile inline path renders the SAME card.
  const bookingMode = apiProperty
    ? resolveBookingMode(apiProperty as Property, rentalMode)
    : 'none';
  const showInlineBookingCard = bookingMode !== 'none' && !isRightBarVisible;

  const showSleepArrangement =
    rentalMode === 'vacation' && isVacationRentable;

  return (
    <View style={styles.scrollContainer}>
      <View
        style={
          Platform.OS === 'web'
            ? styles.webHeaderWrapper
            : styles.nativeHeaderWrapper
        }
      >
        <Header
          options={{
            showBackButton: true,
            title: '',
            titlePosition: 'center',
            transparent: true,
            scrollThreshold: 100,
            // Once the sticky property bar takes over the top, it owns
            // the back / share / save affordances — strip them here so
            // the two bars don't double up.
            rightComponents: stickyHeaderVisible
              ? []
              : [
                  landlordProfileId ? (
                    <Pressable
                      key="profile"
                      style={styles.headerButton}
                      onPress={() => router.push(`/profile/${landlordProfileId}`)}
                      accessibilityRole="button"
                      accessibilityLabel="Open host profile"
                    >
                      <Ionicons name="person-circle-outline" size={24} color={colors.COLOR_BLACK} />
                    </Pressable>
                  ) : null,
                  <Pressable
                    key="share"
                    style={styles.headerButton}
                    onPress={handleShare}
                    accessibilityRole="button"
                    accessibilityLabel="Share property"
                  >
                    <Ionicons name="share-outline" size={24} color={colors.COLOR_BLACK} />
                  </Pressable>,
                  <Pressable
                    key="viewings"
                    style={styles.headerButton}
                    onPress={() => router.push('/viewings')}
                    accessibilityRole="button"
                    accessibilityLabel="View bookings"
                  >
                    <View style={styles.viewingIconContainer}>
                      <Ionicons
                        name="calendar-outline"
                        size={24}
                        color={colors.COLOR_BLACK}
                      />
                      {hasActiveViewing ? (
                        <View style={styles.viewingBadge}>
                          <Ionicons name="checkmark" size={12} color={colors.primaryForeground} />
                        </View>
                      ) : null}
                    </View>
                  </Pressable>,
                  <View key="save" style={styles.headerSaveWrap}>
                    <SaveButton
                      property={apiProperty as Property}
                      variant="heart"
                      color={colors.COLOR_BLACK}
                      activeColor={colors.error}
                      showCount
                      countDisplayMode="inline"
                    />
                  </View>,
                ],
          }}
        />
      </View>

      <StickyPropertyHeader
        title={property.title}
        priceLabel={property.price}
        property={apiProperty ?? null}
        rentalMode={rentalMode}
        visible={stickyHeaderVisible}
        onBack={() => router.back()}
        onShare={handleShare}
        onCtaPress={handleCtaPress}
      />

      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: spacing['7xl'] },
        ]}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        <HeaderSection
          title={property.title}
          location={property.location}
          bedrooms={property.bedrooms}
          bathrooms={property.bathrooms}
          size={property.size}
          images={property.images as PropertyImage[]}
        />
        <PhotoGrid
          images={property.images as PropertyImage[]}
          t={(key) => t(key) || key}
        />

        <View style={styles.infoContainer}>
          {apiProperty ? (
            <View style={styles.section}>
              <HostStatsCard
                property={apiProperty}
                landlordProfile={landlordProfile}
              />
              <View style={styles.demandRow}>
                <DemandSignal
                  propertyId={property.id}
                  createdAt={apiProperty.createdAt}
                />
              </View>
            </View>
          ) : null}

          <View style={[styles.section, styles.divider]}>
            <BasicInfoSection
              property={apiProperty}
              mode={rentalMode}
              hasActiveViewing={hasActiveViewing}
              onViewingsPress={() => router.push('/viewings')}
            />
            {property.alsoAvailable ? (
              <View style={styles.alsoAvailableRow}>
                <Ionicons
                  name="layers-outline"
                  size={14}
                  color={colors.COLOR_BLACK_LIGHT_3}
                />
                <BloomText style={styles.alsoAvailableText}>
                  {property.alsoAvailable}
                </BloomText>
              </View>
            ) : null}
          </View>

          {showInlineBookingCard && apiProperty ? (
            <View style={[styles.section, styles.divider]}>
              <Section>
                <BookingCard
                  property={apiProperty as Property}
                  priceLabel={property.price}
                  priceSubtitle={property.location}
                  landlordProfile={landlordProfile}
                />
              </Section>
            </View>
          ) : null}

          <View style={[styles.section, styles.divider]}>
            <PropertyDetailsCard property={apiProperty} />
          </View>

          <View style={[styles.section, styles.divider]}>
            <PropertyFeatures property={apiProperty} />
          </View>

          {showSleepArrangement ? (
            <View style={[styles.section, styles.divider]}>
              <SleepArrangement property={apiProperty as Property} />
            </View>
          ) : null}

          <View style={[styles.section, styles.divider]}>
            <PricingDetails property={apiProperty} mode={rentalMode} />
          </View>

          {/* Sale details + mortgage calculator — only for sale listings that
              carry a sale block (gated together so neither leaves a bare
              hairline divider behind). */}
          {saleData ? (
            <View style={[styles.section, styles.divider]}>
              <SaleDetailsSection sale={saleData} />
            </View>
          ) : null}

          {saleData ? (
            <View style={[styles.section, styles.divider]}>
              <MortgageCalculatorSection
                salePrice={saleData.price}
                currency={saleData.currency}
              />
            </View>
          ) : null}

          {/* Home exchange — only for exchange listings that carry an exchange
              block. Gated like the sale section so it never leaves a bare
              hairline divider. */}
          {exchangeData ? (
            <View style={[styles.section, styles.divider]}>
              <ExchangeSection
                exchange={exchangeData}
                onRequestExchange={handleRequestExchange}
              />
            </View>
          ) : null}

          <View style={[styles.section, styles.divider]}>
            <HouseRules property={apiProperty} />
          </View>

          <View style={[styles.section, styles.divider]}>
            <LocationDisplay property={apiProperty as Property} />
          </View>

          <View style={[styles.section, styles.divider]}>
            <PropertyOverview property={apiProperty} />
          </View>

          <View style={[styles.section, styles.divider]}>
            <NeighborhoodInfo property={apiProperty} />
          </View>

          {/* What's nearby — everyday services (pharmacy, school, transit, …)
              near this listing. Gated so a fail-soft / degraded-empty section
              never leaves a bare hairline divider behind. */}
          {showNearbyServicesSection ? (
            <View style={[styles.section, styles.divider]}>
              <NearbyServicesSection propertyId={property.id} />
            </View>
          ) : null}

          <View style={[styles.section, styles.divider]}>
            <AvailabilitySection property={apiProperty} />
          </View>

          <View style={[styles.section, styles.divider]}>
            <AmenitiesSection
              property={apiProperty as { amenities?: string[] | null }}
            />
          </View>

          {/* Community Notes — community-verified notes about the building —
              shown on every listing. */}
          <View style={[styles.section, styles.divider]}>
            <CommunityNotesSection
              property={apiProperty as Property}
              variant="preview"
            />
          </View>

          {/* Reviews — Airbnb-style guest reviews — shown ADDITIONALLY on
              short-stay (vacation/both) listings. Reviews and Community Notes
              are distinct features that coexist; reviews don't replace notes. */}
          {isVacationRentable ? (
            <View style={[styles.section, styles.divider]}>
              <ReviewsSection property={apiProperty as Property} />
            </View>
          ) : null}

          {/* Area context: how this listing's price compares to similar
              homes nearby, plus a carousel of those comparables. Grouped
              between Community Notes and the landlord's own listings. Each
              wrapper is gated so a fail-soft/empty section never leaves a
              bare hairline divider behind. */}
          {showPriceRangeSection ? (
            <View style={[styles.section, styles.divider]}>
              <PriceRangeSection
                propertyId={property.id}
                bedrooms={property.bedrooms}
              />
            </View>
          ) : null}

          {showSimilarHomesSection ? (
            <View style={[styles.section, styles.divider]}>
              <SimilarHomesSection propertyId={property.id} />
            </View>
          ) : null}

          {apiProperty ? (
            <View style={[styles.section, styles.divider]}>
              <LandlordSection
                property={apiProperty}
                landlordProfile={landlordProfile}
                ownerProperties={ownerProperties}
                onApplyPublic={handlePublicHousingApply}
                t={(k, d) => t(k, d ?? '') || (d ?? k)}
              />
            </View>
          ) : null}

          {apiProperty ? (
            <View style={[styles.section, styles.divider]}>
              <SindiSection property={apiProperty} />
            </View>
          ) : null}
          <View style={[styles.section, styles.divider]}>
            <FraudWarning
              text={
                t(
                  'Never pay or transfer funds outside the Homio platform',
                  'Never pay or transfer funds outside the Homio platform',
                ) || 'Never pay or transfer funds outside the Homio platform'
              }
            />
          </View>
        </View>
      </Animated.ScrollView>

      <PropertyActionBar
        property={apiProperty}
        landlordProfile={landlordProfile}
        canContact={Boolean(oxyServices && activeSessionId)}
        canCall={Boolean(oxyServices && activeSessionId && landlordProfile)}
        onContact={handleContact}
        onCall={handleCall}
        onApplyPublic={handlePublicHousingApply}
        isSaleListing={isSaleListing}
        onRequestViewing={handleRequestViewing}
        isExchangeListing={isExchangeListing}
        onRequestExchange={handleRequestExchange}
      />

      {/* Mounted on-demand: the request flow (and its own-properties query) only
          spins up once the authed user opens the sheet, never on idle views. */}
      {exchangeData && apiProperty && exchangeSheetVisible ? (
        <ExchangeRequestBottomSheet
          property={apiProperty as Property}
          visible={exchangeSheetVisible}
          onClose={() => setExchangeSheetVisible(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContainer: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing['6xl'] },
  errorRoot: { flex: 1 },
  errorBody: { flex: 1 },
  headerButton: { padding: spacing.sm },
  headerSaveWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  // Demand signal sits just under the host card, sharing its gutter.
  demandRow: {
    paddingHorizontal: SECTION_GUTTER,
    marginTop: spacing.md,
  },
  // "Also available" line under the headline price, sharing the section gutter.
  alsoAvailableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: SECTION_GUTTER,
    marginTop: spacing.md,
  },
  alsoAvailableText: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  divider: {
    borderTopWidth: hairline.width,
    borderTopColor: hairline.color,
  },
  webHeaderWrapper: Platform.select({
    web: { position: 'sticky', top: 0, left: 0, right: 0, zIndex: 1000 },
    default: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000 },
  }) as ViewStyleSticky,
  nativeHeaderWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
  },
  viewingIconContainer: { position: 'relative' },
  viewingBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primaryColor,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

// RN-Web supports `position: 'sticky'` even though the type doesn't.
// Wrap as a type alias so we can pass through `Platform.select` cleanly.
type ViewStyleSticky = ReturnType<typeof StyleSheet.create>['x'];
