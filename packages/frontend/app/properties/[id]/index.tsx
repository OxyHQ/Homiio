import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Share,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors } from '@/styles/colors';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { ThemedText } from '@/components/ThemedText';
import { useProperty } from '@/hooks';
import { useOxy } from '@oxyhq/services';
import { Ionicons } from '@expo/vector-icons';
import { toast } from 'sonner';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { PropertyType, PropertyImage, Property } from '@homiio/shared-types';
// getPropertyImageSource handled inside components
import { HeaderSection } from '../../../components/property/HeaderSection';
import { PhotoGallery } from '../../../components/property/PhotoGallery';
import { LandlordSection } from '../../../components/property/LandlordSection';
import { SindiSection } from '../../../components/property/SindiSection';
import { SindiAnalysis } from '../../../components/property/SindiAnalysis';
import { FraudWarning } from '../../../components/property/FraudWarning';
import { BasicInfoSection } from '../../../components/property/BasicInfoSection';
import { PropertyDetailsCard } from '../../../components/property/PropertyDetailsCard';
import { PropertyFeatures } from '../../../components/property/PropertyFeatures';
import { PricingDetails } from '../../../components/property/PricingDetails';
import { HouseRules } from '../../../components/property/HouseRules';
import { LocationSection } from '../../../components/property/LocationSection';
import { PropertyStatistics } from '../../../components/property/PropertyStatistics';
import { NeighborhoodInfo } from '../../../components/property/NeighborhoodInfo';
import { AvailabilitySection } from '../../../components/property/AvailabilitySection';
import { AmenitiesSection } from '../../../components/property/AmenitiesSection';
import { PropertyActionBar } from '../../../components/property/PropertyActionBar';

import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';

import { SaveButton } from '@/components/SaveButton';
import * as Linking from 'expo-linking';
import { propertyService } from '@/services/propertyService';
import ViewingService from '@/services/viewingService';
import Button from '@/components/Button';
import type { Profile } from '@/services/profileService';
import profileService from '@/services/profileService';
// Removed LinearGradient for Sindi banner simplification

// Slim internal view model for share/details (avoid passing through to children)
type PropertyDetail = {
  id: string;
  title: string;
  location: string;
  price: string;
  priceUnit: 'day' | 'night' | 'week' | 'month' | 'year';
  bedrooms: number;
  bathrooms: number;
  size: number;
  images: string[] | PropertyImage[];
};

export default function PropertyDetailPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { oxyServices, activeSessionId } = useOxy();


  const {
    property: apiProperty,
    loading: isLoading,
    error,
    loadProperty,
  } = useProperty(id as string);
  const hasViewedRef = useRef(false);
  const [hasActiveViewing, setHasActiveViewing] = useState(false);
  // Recently viewed tracking
  const { addProperty } = useRecentlyViewed();
  // Landlord data (fetch external)
  const [landlordProfile, setLandlordProfile] = useState<Profile | null>(null);
  const [ownerProperties, setOwnerProperties] = useState<Property[]>([]);

  // Normalize landlordProfileId to string if it's an object (MongoDB $oid)
  let normalizedLandlordProfileId: string | undefined = undefined;
  if (apiProperty?.profileId) {
    if (
      typeof apiProperty.profileId === 'object' &&
      apiProperty.profileId &&
      '$oid' in apiProperty.profileId
    ) {
      normalizedLandlordProfileId = (apiProperty.profileId as any).$oid;
    } else if (typeof apiProperty.profileId === 'string') {
      normalizedLandlordProfileId = apiProperty.profileId;
    }
  }

  // Fetch landlord profile and their properties
  useEffect(() => {
    const fetchLandlordData = async () => {
      if (normalizedLandlordProfileId && oxyServices && activeSessionId) {
        try {
          // Fetch landlord profile
          const profile = await profileService.getProfileById(
            normalizedLandlordProfileId,
            oxyServices,
            activeSessionId,
          );
          setLandlordProfile(profile);

          // Fetch owner's other properties
          const { properties } = await propertyService.getOwnerProperties(
            normalizedLandlordProfileId,
            id as string, // Exclude current property
            oxyServices,
            activeSessionId,
          );
          setOwnerProperties(properties);
        } catch (error) {
          console.error('Error fetching landlord data:', error);
          setLandlordProfile(null);
          setOwnerProperties([]);
        }
      }
    };

    fetchLandlordData();
  }, [normalizedLandlordProfileId, oxyServices, activeSessionId, id]);

  // LandlordSection derives display & trust score internally

  const property = useMemo<PropertyDetail | null>(() => {
    try {
      if (!apiProperty) return null;

      // Defensive ID
      const id = apiProperty._id || apiProperty.id || '';

      const currency = apiProperty.rent?.currency || '⊜';

      // Map legacy paymentFrequency to new priceUnit format
      let priceUnit: 'day' | 'night' | 'week' | 'month' | 'year' = 'month';
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

      const price = apiProperty.rent ? `${currency}${apiProperty.rent.amount}/${priceUnit}` : '';

      // Generate title dynamically from property data
      const generatedTitle = generatePropertyTitle({
        type: Object.values(PropertyType).includes(apiProperty.type)
          ? (apiProperty.type as PropertyType)
          : PropertyType.APARTMENT,
        address: apiProperty.address,
        bedrooms: apiProperty.bedrooms,
        bathrooms: apiProperty.bathrooms,
      });

      return {
        id,
        title: generatedTitle,
        location: `${apiProperty.address?.city || ''}, ${apiProperty.address?.country || ''}`,
        price,
        priceUnit,
        bedrooms: apiProperty.bedrooms || 0,
        bathrooms: apiProperty.bathrooms || 0,
        size: apiProperty.squareFootage || 0,
        images: apiProperty.images || [],
      };
    } catch (err) {
      console.error('Error creating property object:', err);
      return null;
    }
  }, [apiProperty]);
  // Track property view once per load
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

  useEffect(() => {
    hasViewedRef.current = false;
  }, [id]);

  // Load property on component mount
  React.useEffect(() => {
    if (id) {
      loadProperty();
    }
  }, [id, loadProperty]);

  React.useEffect(() => {
    const checkActiveViewing = async () => {
      if (!id || !oxyServices || !activeSessionId) return;

      try {
        const response = await ViewingService.listMyViewingRequests(
          { page: 1, limit: 50 },
          oxyServices,
          activeSessionId,
        );

        const viewings = Array.isArray(response?.data) ? response.data : [];
        const hasActive = viewings.some(
          v => v.propertyId === id && ['pending', 'approved'].includes(v.status)
        );
        setHasActiveViewing(hasActive);
      } catch (error) {
        console.error('Failed to check active viewings:', error);
      }
    };

    checkActiveViewing();
  }, [id, oxyServices, activeSessionId]);

  const handleContact = () => {
    if (apiProperty?.isExternal) {
      // For external properties, open the source website
      if (!apiProperty.sourceUrl) {
        toast.error(t('error.source.noUrl', 'Source website URL not available'));
        return;
      }
      router.push(`/browser?url=${encodeURIComponent(apiProperty.sourceUrl)}`);
      return;
    }

    if (!oxyServices || !activeSessionId) {
      toast.error(t('error.auth.required', 'Please sign in to contact the owner'));
      return;
    }
    router.push(`/chat/${property?.id}`);
  };

  const handleCall = async () => {
    if (!oxyServices || !activeSessionId) {
      toast.error(t('error.auth.required', 'Please sign in to call the owner'));
      return;
    }

    if (!landlordProfile) {
      toast.error(t('error.profile.notFound', 'Owner profile not found'));
      return;
    }

    // Get phone number based on profile type
    let phoneNumber: string | undefined;
    let allowCalls = false;

    if (landlordProfile.personalProfile) {
      // For personal profiles, check contact info in rental history or references
      const latestRental = landlordProfile.personalProfile.rentalHistory?.[0];
      phoneNumber = latestRental?.landlordContact?.phone;
      allowCalls = landlordProfile.personalProfile.settings?.privacy?.showContactInfo ?? false;
    } else if (landlordProfile.agencyProfile) {
      // For agencies, check business details
      phoneNumber = landlordProfile.agencyProfile.businessDetails?.licenseNumber; // Using licenseNumber as a placeholder
      allowCalls = true; // Agencies typically allow calls
    } else if (landlordProfile.businessProfile) {
      // For businesses, check business details
      phoneNumber = landlordProfile.businessProfile.businessDetails?.licenseNumber; // Using licenseNumber as a placeholder
      allowCalls = true; // Businesses typically allow calls
    } else if (landlordProfile.cooperativeProfile) {
      // For cooperatives, use legal name as identifier
      phoneNumber = landlordProfile.cooperativeProfile.legalName; // Using legalName as a placeholder
      allowCalls = true; // Cooperatives typically allow calls
    }

    if (!allowCalls) {
      toast.error(t('error.call.notAllowed', 'Owner does not accept calls'));
      return;
    }

    if (!phoneNumber) {
      toast.error(t('error.call.noPhone', 'No phone number available'));
      return;
    }

    // Open phone dialer using Expo Linking
    try {
      await Linking.openURL(`tel:${phoneNumber}`);
    } catch (error) {
      console.error('Error opening phone dialer:', error);
      toast.error(t('error.call.failed', 'Could not open phone dialer'));
    }
  };

  const handlePublicHousingApply = () => {
    // Get state from property address to redirect to appropriate website
    const state = (apiProperty?.address?.state || '').toLowerCase();

    // State-specific public housing websites (examples)
    const stateWebsites: { [key: string]: string } = {
      california:
        'https://www.hcd.ca.gov/grants-funding/active-funding/multifamily-housing-program',
      'new york': 'https://www.nyshcr.org/',
      texas: 'https://www.tdhca.state.tx.us/',
      florida: 'https://www.floridahousing.org/',
      // Add more states as needed
    };

    const websiteUrl =
      stateWebsites[state] || 'https://www.hud.gov/topics/rental_assistance/phprog';

    // Open external browser
    router.push(`/browser?url=${encodeURIComponent(websiteUrl)}`);
  };

  const handleShare = async () => {
    if (!property) return;
    const propertyUrl = `https://homiio.com/properties/${property.id}`;
    const details = `🏠 ${property.title}\n\n📍 ${property.location}\n💰 ${property.price}\n🛏️ ${property.bedrooms} Bedrooms\n🚿 ${property.bathrooms} Bathrooms\n📏 ${property.size}m²\n\n${propertyUrl}`;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await Share.share({ message: details, url: propertyUrl, title: 'Share Property' });
    } catch {
      try {
        await Clipboard.setStringAsync(details);
        toast.success('Property details copied to clipboard!');
      } catch {
        toast.error('Failed to share property');
      }
    }
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1 }}>
        <Header
          options={{
            showBackButton: true,
            title: t('Loading...') || 'Loading...',
            titlePosition: 'center',
          }}
        />
        <SafeAreaView style={styles.contentArea} edges={['top']}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primaryColor} />
            <ThemedText style={styles.loadingText}>
              {t('property.loading') || 'Loading property...'}
            </ThemedText>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (error || !property) {
    return (
      <View style={{ flex: 1 }}>
        <Header
          options={{
            showBackButton: true,
            title: t('property.error') || 'Error',
            titlePosition: 'center',
          }}
        />
        <SafeAreaView style={styles.contentArea} edges={['top']}>
          <View style={styles.errorContainer}>
            <ThemedText style={styles.errorText}>
              {t('property.notFound') || 'Property not found'}
            </ThemedText>
            <Button onPress={() => router.back()} style={styles.goBackButton}>
              {t('goBack') || 'Go Back'}
            </Button>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.safeArea}>
      <View style={Platform.OS === 'web' ? styles.webHeaderWrapper : styles.nativeHeaderWrapper}>
        <Header
          options={{
            showBackButton: true,
            title: '',
            titlePosition: 'center',
            transparent: true,
            scrollThreshold: 100,
            rightComponents: [
              normalizedLandlordProfileId ? (
                <TouchableOpacity
                  key="profile"
                  style={styles.headerButton}
                  onPress={() => router.push(`/profile/${normalizedLandlordProfileId}`)}
                >
                  <Ionicons name="person-circle-outline" size={24} color="#222" />
                </TouchableOpacity>
              ) : null,
              <TouchableOpacity key="share" style={styles.headerButton} onPress={handleShare}>
                <Ionicons name="share-outline" size={24} color="#222" />
              </TouchableOpacity>,
              <TouchableOpacity
                key="viewings"
                style={styles.headerButton}
                onPress={() => router.push('/viewings')}
              >
                <View style={styles.viewingIconContainer}>
                  <Ionicons name="calendar-outline" size={24} color="#222" />
                  {hasActiveViewing && (
                    <View style={styles.viewingBadge}>
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    </View>
                  )}
                </View>
              </TouchableOpacity>,
              <View
                key="save-with-count"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <SaveButton
                  property={apiProperty as any}
                  variant="heart"
                  color="#222"
                  activeColor="#EF4444"
                  showCount
                  countDisplayMode="inline"
                />
              </View>,
            ],
          }}
        />
      </View>
      <View>
        <HeaderSection
          title={property.title}
          location={property.location}
          bedrooms={property.bedrooms}
          bathrooms={property.bathrooms}
          size={property.size}
          images={property.images as any}
        />
        <PhotoGallery
          images={property.images as any}
          onOpen={() => { /* TODO: implement modal gallery */ }}
          t={t as any}
        />
        <View style={styles.infoContainer}>
          <BasicInfoSection property={apiProperty as any} hasActiveViewing={hasActiveViewing} onViewingsPress={() => router.push('/viewings')} />
          <PropertyDetailsCard property={apiProperty as any} />
          <PropertyFeatures property={apiProperty as any} />
          <PricingDetails property={apiProperty as any} />
          <HouseRules property={apiProperty as any} />
          <LocationSection property={apiProperty as any} />
          <PropertyStatistics property={apiProperty as any} />
          <NeighborhoodInfo property={apiProperty as any} />
          <AvailabilitySection property={apiProperty as any} />
          <AmenitiesSection property={apiProperty as any} />
          <LandlordSection
            property={apiProperty as any}
            landlordProfile={landlordProfile as any}
            ownerProperties={ownerProperties as any}
            onApplyPublic={handlePublicHousingApply}
            t={t as any}
          />
          <SindiSection property={apiProperty as any} />
          <SindiAnalysis property={apiProperty as any} />
          <FraudWarning text={t('Never pay or transfer funds outside the Homio platform') || 'Never pay or transfer funds outside the Homio platform'} />
        </View>
      </View>
      <PropertyActionBar
        property={apiProperty as any}
        landlordProfile={landlordProfile}
        canContact={!!(oxyServices && activeSessionId)}
        canCall={!!(oxyServices && activeSessionId && landlordProfile)}
        onContact={handleContact}
        onCall={handleCall}
        onApplyPublic={handlePublicHousingApply}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, position: 'relative' },
  contentArea: {},
  headerButton: { padding: 8 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { marginTop: 10, fontSize: 16, color: colors.COLOR_BLACK_LIGHT_3 },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorText: { marginTop: 10, marginBottom: 20, fontSize: 18, color: colors.COLOR_BLACK_LIGHT_3 },
  goBackButton: { backgroundColor: colors.primaryColor, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 25 },
  infoContainer: { padding: 20 },
  webHeaderWrapper: { position: 'sticky' as any, top: 0, left: 0, right: 0, zIndex: 1000 },
  nativeHeaderWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000 },
  viewingIconContainer: { position: 'relative' },
  viewingBadge: { position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.primaryColor, justifyContent: 'center', alignItems: 'center' },
});
