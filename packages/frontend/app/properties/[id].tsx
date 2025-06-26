import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform, TextInput, Modal, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors } from '@/styles/colors';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { PropertyMap } from '@/components/PropertyMap';
import { ThemedText } from '@/components/ThemedText';
import { useProperty } from '@/hooks/usePropertyQueries';
import { useOxy } from '@oxyhq/services';
import { Ionicons } from '@expo/vector-icons';
import { toast } from 'sonner';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { getPropertyImageSource } from '@/utils/propertyUtils';
import { getAmenityById, getCategoryById } from '@/constants/amenities';
import { useDispatch, useSelector } from 'react-redux';
import { fetchLandlordProfileById } from '@/store/reducers/profileReducer';
import { fetchRecentlyViewedProperties, addPropertyToRecentlyViewed } from '@/store/reducers/recentlyViewedReducer';
import { useFavorites } from '@/hooks/useFavorites';
import type { RootState, AppDispatch } from '@/store/store';
import { userApi } from '@/utils/api';
import { SaveButton } from '@/components/SaveButton';

type PropertyDetail = {
  id: string;
  title: string;
  description: string;
  location: string;
  price: string;
  bedrooms: number;
  bathrooms: number;
  size: number;
  isVerified: boolean;
  isEcoCertified: boolean;
  amenities: string[];
  landlordName: string;
  landlordRating: number;
  availableFrom: string;
  minStay: string;
  rating: number;
  energyRating: string;
  images: string[]; // placeholder for now
};

const IconComponent = Ionicons as any;

export default function PropertyDetailPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { oxyServices, activeSessionId } = useOxy();
  const { data: apiProperty, isLoading, error } = useProperty(id as string);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [landlordVerified, setLandlordVerified] = useState(true);
  const hasViewedRef = useRef(false);

  // Redux favorites
  const { isFavorite, toggleFavorite, isPropertySaving } = useFavorites();

  // Redux: fetch landlord profile by profileId
  const dispatch = useDispatch<AppDispatch>();
  const landlordProfileId = apiProperty?.profileId;
  const landlordProfile = useSelector((state: RootState) => state.profile.landlordProfile);
  const landlordLoading = useSelector((state: RootState) => state.profile.landlordProfileLoading);

  // Get current user's primary profile for tracking
  const primaryProfile = useSelector((state: RootState) => state.profile.primaryProfile);

  // Normalize landlordProfileId to string if it's an object (MongoDB $oid)
  let normalizedLandlordProfileId: string | undefined = undefined;
  if (landlordProfileId) {
    if (typeof landlordProfileId === 'object' && landlordProfileId && '$oid' in landlordProfileId) {
      normalizedLandlordProfileId = (landlordProfileId as any).$oid;
    } else if (typeof landlordProfileId === 'string') {
      normalizedLandlordProfileId = landlordProfileId;
    }
  }

  useEffect(() => {
    if (normalizedLandlordProfileId) {
      dispatch(fetchLandlordProfileById({ profileId: normalizedLandlordProfileId, oxyServices, activeSessionId }));
    }
  }, [normalizedLandlordProfileId, oxyServices, activeSessionId, dispatch]);

  // Debug logging
  useEffect(() => {
    console.log('PropertyDetailPage Debug:', {
      id,
      apiProperty: !!apiProperty,
      isLoading,
      error: error?.message,
      oxyServices: !!oxyServices,
      activeSessionId: !!activeSessionId
    });
  }, [id, apiProperty, isLoading, error, oxyServices, activeSessionId]);

  const property = useMemo<PropertyDetail | null>(() => {
    if (!apiProperty) return null;

    try {
      const currency = apiProperty.rent?.currency || '⊜';
      const price = apiProperty.rent
        ? `${currency}${apiProperty.rent.amount}/${apiProperty.rent.paymentFrequency || 'month'}`
        : '';

      // Generate title dynamically from property data
      const generatedTitle = generatePropertyTitle({
        type: apiProperty.type,
        address: apiProperty.address,
        bedrooms: apiProperty.bedrooms,
        bathrooms: apiProperty.bathrooms
      });

      return {
        id: apiProperty._id || apiProperty.id || '',
        title: generatedTitle,
        description: apiProperty.description || '',
        location: `${apiProperty.address?.city || ''}, ${apiProperty.address?.country || ''}`,
        price,
        bedrooms: apiProperty.bedrooms || 0,
        bathrooms: apiProperty.bathrooms || 0,
        size: apiProperty.squareFootage || 0,
        isVerified: apiProperty.status === 'available',
        isEcoCertified:
          apiProperty.amenities?.some(a => a.toLowerCase().includes('eco')) || false,
        amenities: apiProperty.amenities || [],
        landlordName: '',
        landlordRating: 0,
        availableFrom: apiProperty.createdAt?.split('T')[0] || '',
        minStay: 'N/A',
        rating: 0,
        energyRating: apiProperty.energyStats ? 'A' : 'N/A',
        images: apiProperty.images || [],
      };
    } catch (err) {
      console.error('Error creating property object:', err);
      return null;
    }
  }, [apiProperty]);

  // Set document title for web
  useDocumentTitle(property?.title || 'Property Details');

  // Track property view when property is loaded and user is authenticated
  useEffect(() => {
    if (apiProperty && !hasViewedRef.current && oxyServices && activeSessionId) {
      hasViewedRef.current = true;

      console.log('PropertyDetailPage: Tracking property view for authenticated user', {
        propertyId: apiProperty._id || apiProperty.id,
        hasOxyServices: !!oxyServices,
        hasActiveSession: !!activeSessionId
      });

      // Add property to Redux state immediately for instant UI feedback
      dispatch(addPropertyToRecentlyViewed(apiProperty));

      // Call the backend to track the view in database
      userApi.trackPropertyView(apiProperty._id || apiProperty.id, oxyServices, activeSessionId)
        .then(() => {
          console.log('PropertyDetailPage: Successfully tracked property view in backend');
          // Refresh recently viewed from backend to get the updated list
          dispatch(fetchRecentlyViewedProperties({ oxyServices, activeSessionId }));
        })
        .catch((error) => {
          console.error('PropertyDetailPage: Failed to track property view in backend:', error);
        });
    } else if (apiProperty && !hasViewedRef.current) {
      console.log('PropertyDetailPage: User not authenticated, skipping backend view tracking');
      hasViewedRef.current = true;

      // For unauthenticated users, only add to local Redux state
      dispatch(addPropertyToRecentlyViewed(apiProperty));
    }
  }, [apiProperty, oxyServices, activeSessionId, dispatch]);

  const handleContact = () => {
    // In a real app, this would open a chat with the landlord
    router.push(`/chat/${property?.id}`);
  };

  const handleScheduleViewing = () => {
    // In a real app, this would navigate to a booking screen
    router.push(`/properties/${property?.id}/book-viewing`);
  };

  const handleApply = () => {
    // In a real app, this would navigate to a rental application form
    router.push(`/properties/${property?.id}/apply`);
  };

  const handleShare = async () => {
    if (!property) return;

    try {
      // Add haptic feedback
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Create a deep link to the property
      const propertyUrl = `https://homiio.com/properties/${property.id}`;

      // Full details for clipboard
      const fullDetails = `🏠 ${property.title}

📍 ${property.location}
💰 ${property.price}
🛏️ ${property.bedrooms} Bedrooms
🚿 ${property.bathrooms} Bathrooms
📏 ${property.size}m²

${propertyUrl}`;

      const isAvailable = await Sharing.isAvailableAsync();

      if (isAvailable) {
        // Share only the link via native sharing
        await Sharing.shareAsync(propertyUrl, {
          mimeType: 'text/plain',
          dialogTitle: 'Share Property',
        });
      } else {
        // Copy full details to clipboard
        await Clipboard.setStringAsync(fullDetails);
        toast.success('Property details copied to clipboard!');
      }
    } catch (error) {
      console.error('Error sharing property:', error);
      // Fallback: copy full details to clipboard
      try {
        const propertyUrl = `https://homiio.com/properties/${property.id}`;
        const fallbackMessage = `🏠 ${property.title}\n\n📍 ${property.location}\n💰 ${property.price}\n🛏️ ${property.bedrooms} Bedrooms\n🚿 ${property.bathrooms} Bathrooms\n📏 ${property.size}m²\n\n${propertyUrl}`;
        await Clipboard.setStringAsync(fallbackMessage);
        toast.success('Property details copied to clipboard!');
      } catch (clipboardError) {
        toast.error('Failed to share property');
      }
    }
  };

  const renderAmenitiesByCategory = () => {
    if (!property?.amenities || property.amenities.length === 0) return null;

    // Group amenities by category
    const amenitiesByCategory: { [key: string]: any[] } = {};
    const uncategorized: any[] = [];

    property.amenities.forEach(amenityId => {
      const amenityConfig = getAmenityById(amenityId);
      if (amenityConfig) {
        const category = amenityConfig.category;
        if (!amenitiesByCategory[category]) {
          amenitiesByCategory[category] = [];
        }
        amenitiesByCategory[category].push(amenityConfig);
      } else {
        uncategorized.push({ id: amenityId, name: amenityId });
      }
    });

    // Sort categories by priority: essential, accessibility, then others
    const categoryOrder = ['essential', 'accessibility', 'eco', 'security', 'comfort', 'kitchen', 'technology', 'transportation', 'outdoor', 'wellness', 'community', 'storage'];
    const sortedCategories = Object.keys(amenitiesByCategory).sort((a, b) => {
      const indexA = categoryOrder.indexOf(a);
      const indexB = categoryOrder.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    return (
      <View style={styles.categorizedAmenities}>
        {sortedCategories.map(categoryId => {
          const categoryInfo = getCategoryById(categoryId);
          const categoryAmenities = amenitiesByCategory[categoryId];

          if (!categoryInfo || !categoryAmenities.length) return null;

          return (
            <View key={categoryId} style={styles.amenityCategory}>
              <View style={styles.categoryHeader}>
                <View style={[styles.categoryIcon, { backgroundColor: categoryInfo.color + '15' }]}>
                  <IconComponent
                    name={categoryInfo.icon as any}
                    size={20}
                    color={categoryInfo.color}
                  />
                </View>
                <Text style={styles.categoryTitle}>{categoryInfo.name}</Text>
                <View style={[styles.categoryBadge, { backgroundColor: categoryInfo.color }]}>
                  <Text style={styles.categoryBadgeText}>{categoryAmenities.length}</Text>
                </View>
              </View>

              <View style={styles.categoryAmenities}>
                {categoryAmenities.map((amenity, index) => (
                  <View key={amenity.id} style={[
                    styles.modernAmenityCard,
                    amenity.essential && styles.essentialCard,
                    amenity.accessibility && styles.accessibilityCard
                  ]}>
                    <View style={styles.amenityCardContent}>
                      <View style={[styles.amenityCardIcon, { backgroundColor: categoryInfo.color + '10' }]}>
                        <IconComponent
                          name={amenity.icon as any}
                          size={18}
                          color={categoryInfo.color}
                        />
                      </View>
                      <View style={styles.amenityCardText}>
                        <Text style={styles.amenityCardTitle}>{amenity.name}</Text>
                        {amenity.description && (
                          <Text style={styles.amenityCardDescription} numberOfLines={2}>
                            {amenity.description}
                          </Text>
                        )}
                        <View style={styles.amenityTags}>
                          {amenity.essential && (
                            <View style={[styles.amenityTag, styles.essentialTag]}>
                              <Text style={styles.amenityTagText}>Essential</Text>
                            </View>
                          )}
                          {amenity.accessibility && (
                            <View style={[styles.amenityTag, styles.accessibilityTag]}>
                              <Text style={styles.amenityTagText}>Accessible</Text>
                            </View>
                          )}
                          {amenity.environmental === 'positive' && (
                            <View style={[styles.amenityTag, styles.ecoTag]}>
                              <Text style={styles.amenityTagText}>Eco</Text>
                            </View>
                          )}
                          {amenity.maxFairValue === 0 && (
                            <View style={[styles.amenityTag, styles.includedTag]}>
                              <Text style={styles.amenityTagText}>Included</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          );
        })}

        {/* Show uncategorized amenities if any */}
        {uncategorized.length > 0 && (
          <View style={styles.amenityCategory}>
            <View style={styles.categoryHeader}>
              <View style={[styles.categoryIcon, { backgroundColor: colors.COLOR_BLACK_LIGHT_4 + '15' }]}>
                <IconComponent
                  name="ellipsis-horizontal"
                  size={20}
                  color={colors.COLOR_BLACK_LIGHT_3}
                />
              </View>
              <Text style={styles.categoryTitle}>Other Features</Text>
              <View style={[styles.categoryBadge, { backgroundColor: colors.COLOR_BLACK_LIGHT_3 }]}>
                <Text style={styles.categoryBadgeText}>{uncategorized.length}</Text>
              </View>
            </View>

            <View style={styles.categoryAmenities}>
              {uncategorized.map((amenity, index) => (
                <View key={amenity.id} style={styles.modernAmenityCard}>
                  <View style={styles.amenityCardContent}>
                    <View style={[styles.amenityCardIcon, { backgroundColor: colors.COLOR_BLACK_LIGHT_4 + '10' }]}>
                      <IconComponent
                        name="checkmark-circle"
                        size={18}
                        color={colors.COLOR_BLACK_LIGHT_3}
                      />
                    </View>
                    <View style={styles.amenityCardText}>
                      <Text style={styles.amenityCardTitle}>{amenity.name}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    );
  };

  const renderAmenity = (amenity: string, index: number) => {
    // Try to find amenity in our comprehensive config first
    const amenityConfig = getAmenityById(amenity);

    if (amenityConfig) {
      return (
        <View key={index} style={[
          styles.amenityItem,
          amenityConfig.essential && styles.essentialAmenityItem,
          amenityConfig.accessibility && styles.accessibilityAmenityItem
        ]}>
          <View style={[
            styles.amenityIconContainer,
            amenityConfig.essential && styles.essentialAmenityIconContainer,
            amenityConfig.accessibility && styles.accessibilityAmenityIconContainer
          ]}>
            <IconComponent
              name={amenityConfig.icon as any}
              size={20}
              color={
                amenityConfig.accessibility ? '#6366f1' :
                  amenityConfig.essential ? '#059669' :
                    amenityConfig.environmental === 'positive' ? '#16a34a' :
                      colors.primaryColor
              }
            />
          </View>
          <View style={styles.amenityTextContainer}>
            <Text style={[
              styles.amenityText,
              amenityConfig.essential && styles.essentialAmenityText,
              amenityConfig.accessibility && styles.accessibilityAmenityText
            ]}>
              {amenityConfig.name}
              {amenityConfig.essential && (
                <Text style={styles.essentialBadge}> ESSENTIAL</Text>
              )}
              {amenityConfig.accessibility && (
                <Text style={styles.accessibilityBadge}> ACCESSIBLE</Text>
              )}
              {amenityConfig.environmental === 'positive' && (
                <Text style={styles.ecoBadge}> ECO</Text>
              )}
            </Text>
            {amenityConfig.description && (
              <Text style={styles.amenityDescription}>
                {amenityConfig.description}
              </Text>
            )}
            {amenityConfig.ethicalNotes && (
              <Text style={styles.amenityEthicalNotes}>
                {amenityConfig.ethicalNotes}
              </Text>
            )}
          </View>
        </View>
      );
    }

    // Fallback to legacy mapping for old amenity strings
    const getAmenityIcon = (amenityName: string) => {
      const lowerAmenity = amenityName.toLowerCase();

      if (lowerAmenity.includes('wifi') || lowerAmenity.includes('internet')) return 'wifi';
      if (lowerAmenity.includes('parking') || lowerAmenity.includes('garage')) return 'car';
      if (lowerAmenity.includes('gym') || lowerAmenity.includes('fitness')) return 'fitness';
      if (lowerAmenity.includes('pool') || lowerAmenity.includes('swimming')) return 'water';
      if (lowerAmenity.includes('balcony') || lowerAmenity.includes('terrace')) return 'leaf';
      if (lowerAmenity.includes('elevator') || lowerAmenity.includes('lift')) return 'arrow-up';
      if (lowerAmenity.includes('air conditioning') || lowerAmenity.includes('ac')) return 'snow';
      if (lowerAmenity.includes('heating') || lowerAmenity.includes('heat')) return 'flame';
      if (lowerAmenity.includes('dishwasher') || lowerAmenity.includes('washer')) return 'water';
      if (lowerAmenity.includes('laundry') || lowerAmenity.includes('washing')) return 'shirt';
      if (lowerAmenity.includes('pet') || lowerAmenity.includes('dog') || lowerAmenity.includes('cat')) return 'paw';
      if (lowerAmenity.includes('furnished') || lowerAmenity.includes('furniture')) return 'bed';
      if (lowerAmenity.includes('security') || lowerAmenity.includes('cctv')) return 'shield-checkmark';
      if (lowerAmenity.includes('garden') || lowerAmenity.includes('yard')) return 'flower';
      if (lowerAmenity.includes('bike') || lowerAmenity.includes('bicycle')) return 'bicycle';
      if (lowerAmenity.includes('storage') || lowerAmenity.includes('closet')) return 'cube';
      if (lowerAmenity.includes('fireplace') || lowerAmenity.includes('fire')) return 'flame';
      if (lowerAmenity.includes('view') || lowerAmenity.includes('mountain') || lowerAmenity.includes('sea')) return 'eye';
      if (lowerAmenity.includes('eco') || lowerAmenity.includes('green') || lowerAmenity.includes('solar')) return 'leaf';
      if (lowerAmenity.includes('rooftop') || lowerAmenity.includes('roof')) return 'home';
      if (lowerAmenity.includes('concierge') || lowerAmenity.includes('doorman')) return 'person';
      if (lowerAmenity.includes('playground') || lowerAmenity.includes('kids')) return 'happy';
      if (lowerAmenity.includes('bbq') || lowerAmenity.includes('grill')) return 'restaurant';
      if (lowerAmenity.includes('sauna') || lowerAmenity.includes('spa')) return 'thermometer';
      if (lowerAmenity.includes('tennis') || lowerAmenity.includes('sport')) return 'tennisball';

      // Default icon for unmatched amenities
      return 'checkmark-circle';
    };

    return (
      <View key={index} style={styles.amenityItem}>
        <View style={styles.amenityIconContainer}>
          <IconComponent
            name={getAmenityIcon(amenity) as any}
            size={20}
            color={colors.primaryColor}
          />
        </View>
        <Text style={styles.amenityText}>{amenity}</Text>
      </View>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Header
          options={{
            showBackButton: true,
            title: t("Loading..."),
            titlePosition: 'center',
          }}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primaryColor} />
          <Text style={styles.loadingText}>{t("Loading property details...")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !property) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Header
          options={{
            showBackButton: true,
            title: t("Error"),
            titlePosition: 'center',
          }}
        />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{t("Property not found")}</Text>
          <TouchableOpacity
            style={styles.goBackButton}
            onPress={() => router.back()}
          >
            <Text style={styles.goBackButtonText}>{t("Go Back")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isPropertyFavorite = isFavorite(property.id);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Header
        options={{
          showBackButton: true,
          title: '',
          titlePosition: 'center',
          rightComponents: [
            <TouchableOpacity key="share" style={styles.headerButton} onPress={handleShare}>
              <IconComponent name="share-outline" size={24} color={colors.COLOR_BLACK} />
            </TouchableOpacity>,
            <SaveButton
              key="save"
              isSaved={isPropertyFavorite}
              onPress={() => toggleFavorite(property.id || '', property)}
              variant="heart"
              color="#ccc"
              activeColor="#EF4444"
              isLoading={isPropertySaving(property.id || '')}
            />,
          ],
        }}
      />

      {/* Enhanced Header Section */}
      <View style={styles.enhancedHeader}>
        <Text style={styles.headerTitle} numberOfLines={2}>{property.title}</Text>
        <View style={styles.headerLocation}>
          <Text style={styles.headerLocationText}>{property.location}</Text>
        </View>
        <View style={styles.headerStats}>
          <View style={styles.headerStat}>
            <Text style={styles.headerStatText}>{property.bedrooms} {t("Bed")}</Text>
          </View>
          <View style={styles.headerStat}>
            <Text style={styles.headerStatText}>{property.bathrooms} {t("Bath")}</Text>
          </View>
          <View style={styles.headerStat}>
            <Text style={styles.headerStatText}>{property.size}m²</Text>
          </View>
        </View>
      </View>

      <ScrollView style={styles.container}>
        {/* Property Images Grid */}
        <View style={styles.imageGridContainer}>
          <View style={styles.imageGrid}>
            {/* Left Column */}
            <View style={styles.mainImageContainer}>
              <Image
                source={getPropertyImageSource(property.images)}
                style={styles.mainImage}
                resizeMode="cover"
              />
            </View>

            {/* Right Column */}
            <View style={styles.rightColumn}>
              <View style={styles.sideImageContainer}>
                <Image
                  source={getPropertyImageSource(property.images.length > 1 ? property.images.slice(1) : property.images)}
                  style={styles.sideImage}
                  resizeMode="cover"
                />
              </View>
              <View style={styles.mapPreviewContainer}>
                <PropertyMap
                  latitude={apiProperty?.address?.coordinates?.lat || 40.7128}
                  longitude={apiProperty?.address?.coordinates?.lng || -74.0060}
                  address={property.location}
                  height={96}
                  interactive={false}
                />
                <View style={styles.mapOverlay}>
                  <Text style={styles.mapOverlayText}>Location</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Basic Info */}
        <View style={styles.infoContainer}>

          <View style={styles.priceContainer}>
            <Text style={styles.priceLabel}>{t("Monthly Rent")}</Text>
            <Text style={styles.priceValue}>{property.price}</Text>
          </View>

          {/* Eco Rating */}
          {property.isEcoCertified && (
            <>
              <View style={styles.divider} />
              <View style={styles.ecoRatingContainer}>
                <View style={styles.ratingHeader}>
                  <Text style={styles.ratingTitle}>{t("Energy Efficiency")}</Text>
                </View>
                <View style={styles.energyRatingContainer}>
                  <View style={[styles.energyRatingBadge, { backgroundColor: '#2e7d32' }]}>
                    <Text style={styles.energyRatingText}>{property.energyRating}</Text>
                  </View>
                  <Text style={styles.energyRatingDesc}>
                    {t("This property meets high standards for energy efficiency")}
                  </Text>
                </View>
              </View>
            </>
          )}

          {/* Description */}
          {property.description && property.description.trim() !== '' && (
            <>
              <View style={styles.divider} />
              <View style={styles.descriptionContainer}>
                <Text style={styles.sectionTitle}>{t("About this property")}</Text>
                <View style={styles.descriptionCard}>
                  <Text style={styles.descriptionText}>{property.description}</Text>
                </View>
              </View>
            </>
          )}

          {/* Availability */}
          <View style={styles.divider} />
          <View style={styles.availabilityContainer}>
            <View style={styles.availabilityItem}>
              <Text style={styles.availabilityLabel}>{t("Available From")}</Text>
              <Text style={styles.availabilityValue}>{new Date(property.availableFrom).toLocaleDateString()}</Text>
            </View>
            <View style={styles.availabilityItem}>
              <Text style={styles.availabilityLabel}>{t("Minimum Stay")}</Text>
              <Text style={styles.availabilityValue}>{property.minStay}</Text>
            </View>
          </View>

          {/* Amenities */}
          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>{t("What's Included")}</Text>

          {property.amenities.length > 0 ? (
            <View style={styles.amenitiesContainer}>
              {property.amenities.map((amenity, index) => {
                const amenityConfig = getAmenityById(amenity);
                return (
                  <View
                    key={index}
                    style={[
                      styles.amenityChip,
                      amenityConfig?.essential && styles.essentialChip,
                      amenityConfig?.accessibility && styles.accessibilityChip,
                      amenityConfig?.environmental === 'positive' && styles.ecoChip,
                    ]}
                  >
                    {amenityConfig && (
                      <IconComponent
                        name={amenityConfig.icon as any}
                        size={16}
                        color={
                          amenityConfig.accessibility ? '#6366f1' :
                            amenityConfig.essential ? '#059669' :
                              amenityConfig.environmental === 'positive' ? '#16a34a' :
                                colors.primaryColor
                        }
                        style={styles.amenityChipIcon}
                      />
                    )}
                    <Text style={[
                      styles.amenityChipText,
                      amenityConfig?.essential && styles.essentialChipText,
                      amenityConfig?.accessibility && styles.accessibilityChipText,
                      amenityConfig?.environmental === 'positive' && styles.ecoChipText,
                    ]}>
                      {amenityConfig?.nameKey ? t(amenityConfig.nameKey) : (amenityConfig?.name || amenity)}
                    </Text>
                    {amenityConfig?.maxFairValue === 0 && (
                      <View style={styles.includedDot} />
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.noAmenitiesContainer}>
              <IconComponent name="home-outline" size={48} color={colors.COLOR_BLACK_LIGHT_4} />
              <Text style={styles.noAmenitiesText}>{t("No amenities listed")}</Text>
            </View>
          )}

          {/* Map - Only show if location coordinates are available */}
          {apiProperty?.address?.coordinates?.lat && apiProperty?.address?.coordinates?.lng && (
            <>
              <View style={styles.divider} />
              <Text style={styles.sectionTitle}>{t("Location")}</Text>
              <PropertyMap
                latitude={apiProperty.address.coordinates.lat}
                longitude={apiProperty.address.coordinates.lng}
                address={property.location}
                height={200}
                interactive={false}
              />
            </>
          )}

          {/* Landlord Info */}
          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>{t("Landlord")}</Text>
          <View style={styles.landlordCard}>
            <View style={styles.landlordHeader}>
              <View style={styles.landlordAvatar}>
                <Text style={styles.landlordInitial}>
                  {landlordProfile?.profileType === 'personal'
                    ? landlordProfile?.personalProfile?.personalInfo?.bio?.charAt(0)
                    || landlordProfile?.oxyUserId?.charAt(0)
                    || '?'
                    : landlordProfile?.profileType === 'agency'
                      ? landlordProfile?.agencyProfile?.legalCompanyName?.charAt(0)
                      || landlordProfile?.oxyUserId?.charAt(0)
                      || '?'
                      : landlordProfile?.profileType === 'business'
                        ? landlordProfile?.businessProfile?.legalCompanyName?.charAt(0)
                        || landlordProfile?.oxyUserId?.charAt(0)
                        || '?'
                        : landlordProfile?.profileType === 'cooperative'
                          ? landlordProfile?.cooperativeProfile?.legalName?.charAt(0)
                          || landlordProfile?.oxyUserId?.charAt(0)
                          || '?'
                          : landlordProfile?.oxyUserId?.charAt(0) || '?'}
                </Text>
              </View>
              <View style={styles.landlordInfo}>
                <View style={styles.landlordNameRow}>
                  <Text style={styles.landlordName}>
                    {landlordProfile?.profileType === 'personal'
                      ? landlordProfile?.personalProfile?.personalInfo?.bio
                      || landlordProfile?.oxyUserId
                      || '?'
                      : landlordProfile?.profileType === 'agency'
                        ? landlordProfile?.agencyProfile?.legalCompanyName
                        || landlordProfile?.oxyUserId
                        || '?'
                        : landlordProfile?.profileType === 'business'
                          ? landlordProfile?.businessProfile?.legalCompanyName
                          || landlordProfile?.oxyUserId
                          || '?'
                          : landlordProfile?.profileType === 'cooperative'
                            ? landlordProfile?.cooperativeProfile?.legalName
                            || landlordProfile?.oxyUserId
                            || '?'
                            : landlordProfile?.oxyUserId || '?'}
                  </Text>
                  {landlordProfile?.isActive && (
                    <View style={styles.verifiedBadge}>
                      <Text style={styles.verifiedText}>✓</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.landlordRating}>
                  {landlordProfile?.personalProfile?.trustScore?.score ? `Trust Score: ${landlordProfile.personalProfile.trustScore.score}` : ''}
                </Text>
              </View>
            </View>
            <View style={styles.landlordActions}>
              <TouchableOpacity style={styles.messageButton} onPress={handleContact} disabled={!landlordProfile}>
                <Text style={styles.messageButtonText}>{t("Message")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.callButton} onPress={handleContact} disabled={!landlordProfile}>
                <Text style={styles.callButtonText}>{t("Call")}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Trust and Safety */}
          <View style={styles.divider} />
          <View style={styles.trustContainer}>
            <View style={styles.trustTextContainer}>
              <Text style={styles.trustTitle}>{t("Homio Verified")}</Text>
              <Text style={styles.trustDescription}>
                {t("This property has been personally verified by our team for authenticity and condition")}
              </Text>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionButtonsContainer}>
            <TouchableOpacity style={styles.scheduleButton} onPress={handleScheduleViewing}>
              <Text style={styles.scheduleButtonText}>{t("Schedule Viewing")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyButton} onPress={handleApply}>
              <Text style={styles.applyButtonText}>{t("Apply Now")}</Text>
            </TouchableOpacity>
          </View>

          {/* Fraud Warning */}
          <View style={styles.fraudWarningContainer}>
            <Text style={styles.fraudWarningText}>
              {t("Never pay or transfer funds outside the Homio platform")}
            </Text>
          </View>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  headerButton: {
    padding: 8,
  },
  imageContainer: {
    position: 'relative',
  },
  imageGalleryPlaceholder: {
    width: '100%',
    height: 300,
    backgroundColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  galleryPlaceholderText: {
    color: colors.COLOR_BLACK_LIGHT_4,
    fontWeight: '500',
  },
  imageDotContainer: {
    position: 'absolute',
    bottom: 15,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  imageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    marginHorizontal: 4,
  },
  activeImageDot: {
    backgroundColor: 'white',
  },
  verifiedBadge: {
    position: 'absolute',
    top: 15,
    left: 15,
    backgroundColor: colors.primaryColor,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  ecoBadge: {
    position: 'absolute',
    top: 50,
    left: 15,
    backgroundColor: 'green',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  badgeText: {
    color: 'white',
    fontSize: 12,
    marginLeft: 5,
    fontWeight: '500',
  },
  infoContainer: {
    padding: 20,
  },
  propertyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  locationText: {
    marginLeft: 5,
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.primaryLight,
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },
  statItem: {
    alignItems: 'center',
  },
  statText: {
    marginTop: 5,
    fontSize: 14,
  },
  priceContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  priceLabel: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  priceValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primaryColor,
  },
  divider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 20,
  },
  ecoRatingContainer: {
    marginBottom: 15,
  },
  ratingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  ratingTitle: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: 'bold',
  },
  energyRatingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  energyRatingBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  energyRatingText: {
    color: 'white',
    fontWeight: 'bold',
  },
  energyRatingDesc: {
    flex: 1,
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  descriptionText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.COLOR_BLACK,
    textAlign: 'justify',
  },
  availabilityContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  availabilityItem: {
    flex: 1,
  },
  availabilityLabel: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 5,
  },
  availabilityValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  amenitiesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 8,
  },
  // Simple chip styles
  amenityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  essentialChip: {
    backgroundColor: '#f0fdf4',
    borderColor: '#059669',
  },
  accessibilityChip: {
    backgroundColor: '#f0f0ff',
    borderColor: '#6366f1',
  },
  ecoChip: {
    backgroundColor: '#f0fdf4',
    borderColor: '#16a34a',
  },
  amenityChipIcon: {
    marginRight: 6,
  },
  amenityChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.COLOR_BLACK,
  },
  essentialChipText: {
    color: '#059669',
  },
  accessibilityChipText: {
    color: '#6366f1',
  },
  ecoChipText: {
    color: '#16a34a',
  },
  includedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primaryColor,
    marginLeft: 6,
  },
  amenityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: '#e9ecef',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  amenityIconContainer: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primaryColor + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  amenityText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.COLOR_BLACK,
  },
  // Ethical amenity styles
  essentialAmenityItem: {
    borderColor: '#059669',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
  },
  accessibilityAmenityItem: {
    borderColor: '#6366f1',
    backgroundColor: '#F0F0FF',
    borderWidth: 1,
  },
  essentialAmenityIconContainer: {
    backgroundColor: '#059669' + '20',
  },
  accessibilityAmenityIconContainer: {
    backgroundColor: '#6366f1' + '20',
  },
  amenityTextContainer: {
    flex: 1,
  },
  essentialAmenityText: {
    color: '#059669',
    fontWeight: '600',
  },
  accessibilityAmenityText: {
    color: '#6366f1',
    fontWeight: '600',
  },
  essentialBadge: {
    fontSize: 10,
    color: '#059669',
    fontWeight: 'bold',
  },
  accessibilityBadge: {
    fontSize: 10,
    color: '#6366f1',
    fontWeight: 'bold',
  },
  ecoBadge: {
    fontSize: 10,
    color: '#16a34a',
    fontWeight: 'bold',
  },
  amenityDescription: {
    fontSize: 11,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginTop: 2,
    fontStyle: 'italic',
  },
  amenityEthicalNotes: {
    fontSize: 10,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginTop: 4,
    fontStyle: 'italic',
    paddingTop: 4,
    borderTopWidth: 0.5,
    borderTopColor: colors.COLOR_BLACK_LIGHT_4,
  },
  landlordCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  landlordHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  landlordAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4F46E5',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  landlordInitial: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  landlordInfo: {
    flex: 1,
  },
  landlordNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  landlordName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
    marginRight: 8,
  },
  verifiedBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
  },
  verifiedText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  landlordRating: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },
  landlordActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  messageButton: {
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    flex: 1,
    marginRight: 8,
  },
  messageButtonText: {
    color: 'white',
    fontWeight: '600',
    textAlign: 'center',
    fontSize: 14,
  },
  callButton: {
    backgroundColor: '#10B981',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    flex: 1,
    marginLeft: 8,
  },
  callButtonText: {
    color: 'white',
    fontWeight: '600',
    textAlign: 'center',
    fontSize: 14,
  },
  trustContainer: {
    flexDirection: 'row',
    backgroundColor: '#f5f5f5',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },
  trustTextContainer: {
    flex: 1,
  },
  trustTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  trustDescription: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  actionButtonsContainer: {
    flexDirection: 'row',
    marginVertical: 20,
  },
  scheduleButton: {
    flex: 1,
    backgroundColor: colors.primaryLight,
    paddingVertical: 12,
    borderRadius: 8,
    marginRight: 10,
    alignItems: 'center',
  },
  scheduleButtonText: {
    fontWeight: '600',
    color: colors.primaryColor,
  },
  applyButton: {
    flex: 1,
    backgroundColor: colors.primaryColor,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  applyButtonText: {
    fontWeight: '600',
    color: 'white',
  },
  fraudWarningContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    padding: 10,
    borderRadius: 8,
  },
  fraudWarningText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.5,
    opacity: 1,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    marginTop: 10,
    marginBottom: 20,
    fontSize: 18,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  goBackButton: {
    backgroundColor: colors.primaryColor,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  goBackButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },

  mapContainer: {
    marginVertical: 10,
  },
  enhancedHeader: {
    backgroundColor: colors.primaryLight,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    borderTopLeftRadius: 35,
    borderTopRightRadius: 35,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  headerLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerLocationText: {
    marginLeft: 5,
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  headerStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerStat: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerStatText: {
    marginLeft: 5,
    fontSize: 14,
  },
  amenityIconText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  noAmenitiesContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noAmenitiesText: {
    color: colors.COLOR_BLACK_LIGHT_3,
    fontSize: 14,
  },
  headerIconText: {
    fontSize: 20,
    fontWeight: 'bold',
  },

  descriptionContainer: {
    marginBottom: 20,
  },
  descriptionCard: {
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  landlordStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  responseTime: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  imageGridContainer: {
    marginBottom: 12,
    padding: 8,
  },
  imageGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  mainImageContainer: {
    width: '66%',
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
  },
  rightColumn: {
    flex: 1,
    gap: 8,
  },
  sideImageContainer: {
    height: 96,
    borderRadius: 12,
    overflow: 'hidden',
  },
  mapPreviewContainer: {
    height: 96,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  mapOverlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  mapOverlayText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },
  fullWidthContainer: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
  },
  halfWidthContainer: {
    width: '50%',
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
  },
  heroContainer: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
  },
  equalContainer: {
    width: '50%',
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
  },
  lMainContainer: {
    width: '60%',
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
  },
  lTopContainer: {
    width: '40%',
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
  },
  lBottomContainer: {
    width: '40%',
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
  },
  gridContainer: {
    width: '50%',
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
  },
  masonryLarge: {
    width: '60%',
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
  },
  masonrySmall: {
    width: '38%',
    height: 96,
    borderRadius: 12,
    overflow: 'hidden',
  },
  masonryMedium: {
    width: '38%',
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
  },
  detailsContainer: {
    padding: 16,
    paddingTop: 8,
  },
  headerContainer: {
    marginBottom: 20,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  shareOptionsContent: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 16,
    width: '80%',
    maxHeight: '80%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shareOptionsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  shareOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: colors.primaryColor,
    borderRadius: 8,
    marginBottom: 10,
  },
  shareOptionText: {
    marginLeft: 10,
    fontSize: 16,
    fontWeight: 'bold',
  },
  cancelShareButton: {
    backgroundColor: colors.primaryColor,
    padding: 12,
    borderRadius: 8,
    marginTop: 20,
  },
  cancelShareButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  mainImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  sideImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  // Enhanced amenities section styles
  sectionSubtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 20,
    lineHeight: 20,
  },
  amenitiesSection: {
    marginTop: 8,
  },
  noAmenitiesSubtext: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginTop: 8,
    textAlign: 'center',
  },
  categorizedAmenities: {
    gap: 24,
  },
  amenityCategory: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#f1f3f5',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f5',
  },
  categoryIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    flex: 1,
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 24,
    alignItems: 'center',
  },
  categoryBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'white',
  },
  categoryAmenities: {
    gap: 8,
  },
  modernAmenityCard: {
    backgroundColor: '#fafbfc',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  essentialCard: {
    backgroundColor: '#f0fdf4',
    borderColor: '#059669',
  },
  accessibilityCard: {
    backgroundColor: '#f0f0ff',
    borderColor: '#6366f1',
  },
  amenityCardContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  amenityCardIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  amenityCardText: {
    flex: 1,
  },
  amenityCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    marginBottom: 4,
  },
  amenityCardDescription: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 16,
    marginBottom: 8,
  },
  amenityTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  amenityTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  essentialTag: {
    backgroundColor: '#059669',
  },
  accessibilityTag: {
    backgroundColor: '#6366f1',
  },
  ecoTag: {
    backgroundColor: '#16a34a',
  },
  includedTag: {
    backgroundColor: colors.primaryColor,
  },
  amenityTagText: {
    fontSize: 10,
    fontWeight: '600',
    color: 'white',
    textTransform: 'uppercase',
  },
});