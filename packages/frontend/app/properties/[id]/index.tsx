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

import { Header } from '@/components/Header';
import { SaveButton } from '@/components/SaveButton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useIsDesktop } from '@/hooks/useOptimizedMediaQuery';
import { useLayoutScroll } from '@/context/LayoutScrollContext';
import { useAreaInsights, useProperty } from '@/hooks';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useRentalMode } from '@/context/RentalModeContext';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { propertyService } from '@/services/propertyService';
import profileService, { type Profile } from '@/services/profileService';
import ViewingService from '@/services/viewingService';
import { PropertyType, RentMode, type Property, type PropertyImage } from '@homiio/shared-types';

import { PropertyDetailSkeleton } from '@/components/ui/skeletons/PropertyDetailSkeleton';
import { BookingWidget } from '@/components/BookingWidget';

import { PhotoGrid } from '@/components/property/PhotoGrid';
import { HeaderSection } from '@/components/property/HeaderSection';
import { HostStatsCard } from '@/components/property/HostStatsCard';
import { SleepArrangement } from '@/components/property/SleepArrangement';
import { StickyBookingCard } from '@/components/property/StickyBookingCard';
import { LandlordSection } from '@/components/property/LandlordSection';
import { SindiSection } from '@/components/property/SindiSection';
import { SindiAnalysis } from '@/components/property/SindiAnalysis';
import { FraudWarning } from '@/components/property/FraudWarning';
import { BasicInfoSection } from '@/components/property/BasicInfoSection';
import { PropertyDetailsCard } from '@/components/property/PropertyDetailsCard';
import { PropertyFeatures } from '@/components/property/PropertyFeatures';
import { PricingDetails } from '@/components/property/PricingDetails';
import { HouseRules } from '@/components/property/HouseRules';
import { LocationDisplay } from '@/components/property/LocationDisplay';
import { PropertyOverview } from '@/components/property/PropertyOverview';
import { NeighborhoodInfo } from '@/components/property/NeighborhoodInfo';
import { AvailabilitySection } from '@/components/property/AvailabilitySection';
import { AmenitiesSection } from '@/components/property/AmenitiesSection';
import { CommunityNotesSection } from '@/components/property/CommunityNotesSection';
import { PriceRangeSection } from '@/components/property/PriceRangeSection';
import { SimilarHomesSection } from '@/components/property/SimilarHomesSection';
import { DemandSignal } from '@/components/property/DemandSignal';
import { PropertyActionBar } from '@/components/property/PropertyActionBar';
import { StickyPropertyHeader } from '@/components/property/StickyPropertyHeader';
import { SECTION_GUTTER } from '@/components/property/Section';
import { ApplyToRentCTA } from '@/components/property/ApplyToRentCTA';

import { colors } from '@/styles/colors';
import { contentClamp, hairline, spacing } from '@/constants/styles';

interface PropertyDetailViewModel {
  id: string;
  title: string;
  location: string;
  price: string;
  priceUnit: 'day' | 'night' | 'week' | 'month' | 'year';
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
  const { mode: rentalMode } = useRentalMode();
  const isDesktop = useIsDesktop();
  const { addProperty } = useRecentlyViewed();

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

  const hasViewedRef = useRef(false);
  const [hasActiveViewing, setHasActiveViewing] = useState(false);
  const [landlordProfile, setLandlordProfile] = useState<Profile | null>(null);
  const [ownerProperties, setOwnerProperties] = useState<Property[]>([]);
  const [stickyHeaderVisible, setStickyHeaderVisible] = useState(false);

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
    const currency = apiProperty.rent?.currency || '⊜';

    let priceUnit: PropertyDetailViewModel['priceUnit'] = 'month';
    if (apiProperty.priceUnit) {
      priceUnit = apiProperty.priceUnit;
    } else if (apiProperty.rent?.paymentFrequency) {
      switch (apiProperty.rent.paymentFrequency) {
        case 'daily':
          priceUnit = 'day';
          break;
        case 'weekly':
          priceUnit = 'week';
          break;
        case 'monthly':
          priceUnit = 'month';
          break;
        default:
          priceUnit = 'month';
      }
    }
    const price = apiProperty.rent
      ? `${currency}${apiProperty.rent.amount}/${priceUnit}`
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
      location: `${apiProperty.address?.city || ''}, ${apiProperty.address?.country || ''}`,
      price,
      priceUnit,
      bedrooms: apiProperty.bedrooms || 0,
      bathrooms: apiProperty.bathrooms || 0,
      size: apiProperty.squareFootage || 0,
      images: apiProperty.images || [],
    };
  }, [apiProperty]);

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

  const showBookingWidgetMobile =
    !isDesktop &&
    apiProperty &&
    rentalMode === 'vacation' &&
    (apiProperty.rentMode === RentMode.VACATION ||
      apiProperty.rentMode === RentMode.BOTH);

  const showApplyCTAMobile =
    !isDesktop &&
    apiProperty &&
    rentalMode === 'long_term' &&
    apiProperty.rentMode !== RentMode.VACATION;

  const showSleepArrangement =
    apiProperty &&
    rentalMode === 'vacation' &&
    (apiProperty.rentMode === RentMode.VACATION ||
      apiProperty.rentMode === RentMode.BOTH);

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
                          <Ionicons name="checkmark" size={12} color={colors.white} />
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

        <View
          style={isDesktop ? styles.twoColumnContainer : styles.infoContainer}
        >
          <View style={isDesktop ? styles.mainColumn : undefined}>
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
                hasActiveViewing={hasActiveViewing}
                onViewingsPress={() => router.push('/viewings')}
              />
            </View>

            {showBookingWidgetMobile ? (
              <View style={[styles.section, styles.gutter, styles.divider]}>
                <BookingWidget property={apiProperty as Property} />
              </View>
            ) : null}

            {showApplyCTAMobile ? (
              <View style={[styles.section, styles.gutter, styles.divider]}>
                <ApplyToRentCTA
                  propertyId={String(apiProperty?._id ?? apiProperty?.id ?? '')}
                />
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
              <PricingDetails property={apiProperty} />
            </View>

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

            <View style={[styles.section, styles.divider]}>
              <AvailabilitySection property={apiProperty} />
            </View>

            <View style={[styles.section, styles.divider]}>
              <AmenitiesSection
                property={apiProperty as { amenities?: string[] | null }}
              />
            </View>

            <View style={[styles.section, styles.divider]}>
              <CommunityNotesSection
                property={apiProperty as Property}
                variant="preview"
              />
            </View>

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
            {apiProperty ? (
              <View style={[styles.section, styles.divider]}>
                <SindiAnalysis property={apiProperty} />
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
          {isDesktop && apiProperty ? (
            <View style={styles.sideColumn}>
              <StickyBookingCard
                property={apiProperty as Property}
                priceLabel={property.price}
                priceSubtitle={property.location}
              />
            </View>
          ) : null}
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContainer: { flex: 1, backgroundColor: colors.surface },
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
  // Page containers are full-bleed (no horizontal padding) so
  // horizontally-scrolling section bodies can run edge-to-edge. The
  // horizontal gutter lives per-section (Section primitive + section
  // roots, sourced from SECTION_GUTTER) instead. Desktop keeps the
  // content clamp + column gap.
  twoColumnContainer: {
    flexDirection: 'row',
    paddingTop: spacing.md,
    gap: spacing['3xl'],
    maxWidth: contentClamp.page,
    alignSelf: 'center',
    width: '100%',
  },
  mainColumn: {
    flex: 1,
    minWidth: 0,
  },
  sideColumn: {
    width: 380 + SECTION_GUTTER * 2,
    paddingTop: spacing.xl,
    paddingHorizontal: SECTION_GUTTER,
  },
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
  // Horizontal gutter for section roots that don't use the Section
  // primitive (third-party widgets inlined on mobile).
  gutter: {
    paddingHorizontal: SECTION_GUTTER,
  },
  // Demand signal sits just under the host card, sharing its gutter.
  demandRow: {
    paddingHorizontal: SECTION_GUTTER,
    marginTop: spacing.md,
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
