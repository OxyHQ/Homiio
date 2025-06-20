import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { useProperty } from '@/hooks/usePropertyQueries';

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

export default function PropertyDetailPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { data: apiProperty, isLoading, error } = useProperty(id as string);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [landlordVerified, setLandlordVerified] = useState(true);

  const property = useMemo<PropertyDetail | null>(() => {
    if (!apiProperty) return null;

    const currency = apiProperty.rent?.currency || '⊜';
    const price = apiProperty.rent
      ? `${currency}${apiProperty.rent.amount}/${apiProperty.rent.paymentFrequency || 'month'}`
      : '';

    return {
      id: apiProperty.id,
      title: apiProperty.title,
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
  }, [apiProperty]);

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

  const renderAmenity = (amenity: string, index: number) => (
    <View key={index} style={styles.amenityItem}>
      <Ionicons name="checkmark-circle" size={18} color={colors.primaryColor} />
      <Text style={styles.amenityText}>{amenity}</Text>
    </View>
  );

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
          <Ionicons name="alert-circle" size={60} color={colors.COLOR_BLACK_LIGHT_3} />
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Header
        options={{
          showBackButton: true,
          title: property.title,
          titlePosition: 'center',
          rightComponents: [
            <TouchableOpacity key="share" style={styles.headerButton}>
              <Ionicons name="share-outline" size={24} color={colors.COLOR_BLACK} />
            </TouchableOpacity>,
            <TouchableOpacity key="save" style={styles.headerButton}>
              <Ionicons name="bookmark-outline" size={24} color={colors.COLOR_BLACK} />
            </TouchableOpacity>,
          ],
        }}
      />

      <ScrollView style={styles.container}>
        {/* Image Gallery */}
        <View style={styles.imageContainer}>
          <View style={styles.imageGalleryPlaceholder}>
            <Text style={styles.galleryPlaceholderText}>Property Image {activeImageIndex + 1}</Text>
          </View>

          <View style={styles.imageDotContainer}>
            {property.images.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.imageDot,
                  activeImageIndex === index && styles.activeImageDot
                ]}
              />
            ))}
          </View>

          {/* Badges */}
          {property.isVerified && (
            <View style={styles.verifiedBadge}>
              <Ionicons name="shield-checkmark" size={16} color="white" />
              <Text style={styles.badgeText}>{t("Verified Property")}</Text>
            </View>
          )}

          {property.isEcoCertified && (
            <View style={styles.ecoBadge}>
              <Ionicons name="leaf" size={16} color="white" />
              <Text style={styles.badgeText}>{t("Eco-Certified")}</Text>
            </View>
          )}
        </View>

        {/* Basic Info */}
        <View style={styles.infoContainer}>
          <Text style={styles.propertyTitle}>{property.title}</Text>
          <View style={styles.locationContainer}>
            <Ionicons name="location" size={16} color={colors.COLOR_BLACK_LIGHT_3} />
            <Text style={styles.locationText}>{property.location}</Text>
          </View>

          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Ionicons name="bed-outline" size={20} color={colors.COLOR_BLACK} />
              <Text style={styles.statText}>{property.bedrooms} {t("Bedrooms")}</Text>
            </View>
            <View style={styles.statItem}>
              <Ionicons name="water-outline" size={20} color={colors.COLOR_BLACK} />
              <Text style={styles.statText}>{property.bathrooms} {t("Bathrooms")}</Text>
            </View>
            <View style={styles.statItem}>
              <Ionicons name="resize-outline" size={20} color={colors.COLOR_BLACK} />
              <Text style={styles.statText}>{property.size} m²</Text>
            </View>
          </View>

          <View style={styles.priceContainer}>
            <Text style={styles.priceLabel}>{t("Monthly Rent")}</Text>
            <Text style={styles.priceValue}>{property.price}</Text>
          </View>

          <View style={styles.divider} />

          {/* Eco Rating */}
          {property.isEcoCertified && (
            <View style={styles.ecoRatingContainer}>
              <View style={styles.ratingHeader}>
                <Ionicons name="leaf" size={20} color="green" />
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
          )}

          <View style={styles.divider} />

          {/* Description */}
          <Text style={styles.sectionTitle}>{t("About this property")}</Text>
          <Text style={styles.descriptionText}>{property.description}</Text>

          {/* Availability */}
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

          <View style={styles.divider} />

          {/* Amenities */}
          <Text style={styles.sectionTitle}>{t("Amenities")}</Text>
          <View style={styles.amenitiesContainer}>
            {property.amenities.map(renderAmenity)}
          </View>

          <View style={styles.divider} />

          {/* Landlord Info */}
          <Text style={styles.sectionTitle}>{t("Landlord")}</Text>
          <View style={styles.landlordContainer}>
            <View style={styles.landlordInfoContainer}>
              <View style={styles.landlordImagePlaceholder}>
                <Text style={styles.landlordInitial}>{property.landlordName[0]}</Text>
              </View>
              <View style={styles.landlordDetails}>
                <View style={styles.landlordNameContainer}>
                  <Text style={styles.landlordName}>{property.landlordName}</Text>
                  {landlordVerified && (
                    <Ionicons name="checkmark-circle" size={16} color={colors.primaryColor} />
                  )}
                </View>
                <View style={styles.landlordRatingContainer}>
                  <Ionicons name="star" size={14} color="#FFD700" />
                  <Text style={styles.landlordRatingText}>{property.landlordRating}</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity style={styles.contactButton} onPress={handleContact}>
              <Text style={styles.contactButtonText}>{t("Contact")}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          {/* Trust and Safety */}
          <View style={styles.trustContainer}>
            <View style={styles.trustIconContainer}>
              <Ionicons name="shield-checkmark" size={36} color={colors.primaryColor} />
            </View>
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
            <Ionicons name="information-circle" size={20} color={colors.COLOR_BLACK_LIGHT_3} />
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
    backgroundColor: colors.primaryLight,
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
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 20,
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
  },
  amenityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '50%',
    marginBottom: 10,
  },
  amenityText: {
    marginLeft: 8,
    fontSize: 14,
  },
  landlordContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  landlordInfoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  landlordImagePlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  landlordInitial: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  landlordDetails: {
    justifyContent: 'center',
  },
  landlordNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  landlordName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginRight: 5,
  },
  landlordRatingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  landlordRatingText: {
    marginLeft: 5,
    fontSize: 14,
  },
  contactButton: {
    backgroundColor: colors.primaryColor,
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
  },
  contactButtonText: {
    color: 'white',
    fontWeight: '500',
  },
  trustContainer: {
    flexDirection: 'row',
    backgroundColor: '#f5f5f5',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },
  trustIconContainer: {
    marginRight: 15,
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
    marginLeft: 8,
    fontSize: 13,
    color: '#FFA000',
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: colors.COLOR_BLACK_LIGHT_3,
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
});