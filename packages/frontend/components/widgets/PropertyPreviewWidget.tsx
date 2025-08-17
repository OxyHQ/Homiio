import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
import { colors } from '@/styles/colors';
import { ThemedText } from '../ThemedText';
import { Ionicons } from '@expo/vector-icons';
import { BaseWidget } from './BaseWidget';
import { useCreatePropertyFormStore } from '@/store/createPropertyFormStore';
import { LinearGradient } from 'expo-linear-gradient';
import { PropertyCard } from '../PropertyCard';

const IconComponent = Ionicons as any;
const { width: screenWidth } = Dimensions.get('window');

interface PreviewSection {
  id: string;
  title: string;
  icon: string;
  isComplete: boolean;
  hasData: boolean;
}

export function PropertyPreviewWidget() {
  const { formData, currentStep } = useCreatePropertyFormStore();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['basic', 'pricing']),
  );
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Helper function for amenity lookup - defined before useMemo hooks
  const getAmenityById = (id: string) => {
    const amenities = {
      wifi: { name: 'WiFi', icon: 'wifi' },
      parking: { name: 'Parking', icon: 'car' },
      kitchen: { name: 'Kitchen', icon: 'restaurant' },
      laundry: { name: 'Laundry', icon: 'shirt' },
      ac: { name: 'Air Conditioning', icon: 'snow' },
      heating: { name: 'Heating', icon: 'flame' },
      balcony: { name: 'Balcony', icon: 'home' },
      garden: { name: 'Garden', icon: 'leaf' },
      elevator: { name: 'Elevator', icon: 'arrow-up' },
      gym: { name: 'Gym', icon: 'fitness' },
      pool: { name: 'Pool', icon: 'water' },
      pet_friendly: { name: 'Pet Friendly', icon: 'paw' },
    };
    return amenities[id as keyof typeof amenities];
  };

  // Memoized completion status for each section
  const sections: PreviewSection[] = useMemo(
    () => [
      {
        id: 'basic',
        title: 'Basic Info',
        icon: 'information-circle-outline',
        isComplete: !!(
          formData?.basicInfo?.propertyType && formData?.basicInfo?.bedrooms !== undefined
        ),
        hasData: !!(
          formData?.basicInfo?.propertyType || formData?.basicInfo?.bedrooms !== undefined
        ),
      },
      {
        id: 'location',
        title: 'Location',
        icon: 'location-outline',
        isComplete: !!(formData?.location?.city && formData?.location?.state),
        hasData: !!(formData?.location?.city || formData?.location?.state),
      },
      {
        id: 'pricing',
        title: 'Pricing',
        icon: 'card-outline',
        isComplete: !!(formData?.pricing?.monthlyRent && formData?.pricing?.monthlyRent > 0),
        hasData: !!(formData?.pricing?.monthlyRent || formData?.pricing?.securityDeposit),
      },
      {
        id: 'amenities',
        title: 'Amenities',
        icon: 'list-outline',
        isComplete: !!(
          formData?.amenities?.selectedAmenities &&
          formData?.amenities?.selectedAmenities.length > 0
        ),
        hasData: !!formData?.amenities?.selectedAmenities?.length,
      },
      {
        id: 'media',
        title: 'Photos',
        icon: 'camera-outline',
        isComplete: !!(formData?.media?.images && formData?.media?.images.length > 0),
        hasData: !!formData?.media?.images?.length,
      },
      {
        id: 'description',
        title: 'Description',
        icon: 'document-text-outline',
        isComplete: !!(
          formData?.basicInfo?.description && formData?.basicInfo?.description.length > 10
        ),
        hasData: !!formData?.basicInfo?.description,
      },
    ],
    [formData],
  );

  const completionPercentage = useMemo(() => {
    const completedSections = sections.filter((s) => s.isComplete).length;
    return Math.round((completedSections / sections.length) * 100);
  }, [sections]);

  const toggleSection = useCallback((sectionId: string) => {
    setExpandedSections((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  }, []);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  // Auto-toggle section based on current step
  useEffect(() => {
    const stepToSectionMap: { [key: number]: string } = {
      0: 'basic', // Basic Info step
      1: 'location', // Location step
      2: 'pricing', // Pricing step
      3: 'amenities', // Amenities step
      4: 'media', // Media step (or Rules step, depending on property type)
      5: 'description', // Description step or final step
    };

    const sectionToToggle = stepToSectionMap[currentStep];
    if (sectionToToggle) {
      setExpandedSections((prev) => {
        const newSet = new Set<string>();
        // Only keep the current step's section expanded, collapse all others
        newSet.add(sectionToToggle);
        return newSet;
      });
    }
  }, [currentStep]);

  // Memoized property title generation
  const propertyTitle = useMemo(() => {
    if (!formData?.basicInfo?.propertyType || !formData?.location?.city) {
      return 'Property Preview';
    }

    const { propertyType, bedrooms } = formData.basicInfo;
    const { city } = formData.location;
    const typeLabel = propertyType.charAt(0).toUpperCase() + propertyType.slice(1);

    if (propertyType === 'room') {
      return `${bedrooms} Bedroom Room in ${city}`;
    } else if (propertyType === 'studio') {
      return `Studio in ${city}`;
    } else if (propertyType === 'apartment') {
      return `${bedrooms} Bedroom Apartment in ${city}`;
    } else if (propertyType === 'house') {
      return `${bedrooms} Bedroom House in ${city}`;
    } else {
      return `${typeLabel} in ${city}`;
    }
  }, [formData?.basicInfo?.propertyType, formData?.basicInfo?.bedrooms, formData?.location?.city]);

  // Memoized price display
  const priceDisplay = useMemo(() => {
    if (!formData?.pricing?.monthlyRent || formData.pricing.monthlyRent <= 0) return null;
    return `$${formData.pricing.monthlyRent.toLocaleString()}/month`;
  }, [formData?.pricing?.monthlyRent]);

  // Memoized accommodation type label
  const accommodationType = useMemo(() => {
    const typeLabels: { [key: string]: string } = {
      apartment: 'Apartment',
      house: 'House',
      room: 'Room',
      studio: 'Studio',
      couchsurfing: 'Couchsurfing',
      roommates: 'Roommates',
      coliving: 'Co-Living',
      hostel: 'Hostel',
      guesthouse: 'Guesthouse',
      campsite: 'Campsite',
      boat: 'Boat/Houseboat',
      treehouse: 'Treehouse',
      yurt: 'Yurt/Tent',
      other: 'Other',
    };
    return typeLabels[formData?.basicInfo?.propertyType || ''] || 'Property';
  }, [formData?.basicInfo?.propertyType]);

  // Memoized amenities display
  const amenitiesDisplay = useMemo(() => {
    if (
      !formData?.amenities?.selectedAmenities ||
      formData.amenities.selectedAmenities.length === 0
    )
      return [];
    return formData.amenities.selectedAmenities.slice(0, 6).map((amenity: string) => {
      const amenityData = getAmenityById(amenity);
      return amenityData?.name || amenity;
    });
  }, [formData?.amenities?.selectedAmenities]);

  const yesNo = (val?: boolean) => (val === true ? 'Yes' : val === false ? 'No' : '-');

  if (!formData) {
    return (
      <BaseWidget
        title="Live Preview"
        icon={
          <View style={styles.typeBadge}>
            <ThemedText style={styles.typeBadgeText}>Preview</ThemedText>
          </View>
        }
      >
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconContainer}>
            <IconComponent name="eye-outline" size={48} color={colors.COLOR_BLACK_LIGHT_3} />
          </View>
          <ThemedText style={styles.emptyTitle}>Start Building Your Listing</ThemedText>
          <ThemedText style={styles.emptySubtitle}>
            Fill out the form to see a live preview of how your property will appear to potential
            tenants
          </ThemedText>
        </View>
      </BaseWidget>
    );
  }

  return (
    <BaseWidget
      title="Live Preview"
      icon={
        <View style={styles.typeBadge}>
          <ThemedText style={styles.typeBadgeText}>{accommodationType}</ThemedText>
        </View>
      }
    >
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Progress Bar */}
        <View style={styles.progressContainer}>
          <View style={styles.progressHeader}>
            <ThemedText style={styles.progressTitle}>Completion Progress</ThemedText>
            <ThemedText style={styles.progressPercentage}>{completionPercentage}%</ThemedText>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${completionPercentage}%` }]} />
          </View>
        </View>

        {/* Property Card Preview */}
        <View style={styles.propertyCardContainer}>
          <PropertyCard
            title={propertyTitle}
            location={`${formData.location?.city || ''}, ${formData.location?.state || ''}`}
            price={formData.pricing?.monthlyRent || 0}
            currency={formData.pricing?.currency || '$'}
            type={formData.basicInfo?.propertyType as any}
            bedrooms={formData.basicInfo?.bedrooms || 0}
            bathrooms={formData.basicInfo?.bathrooms || 0}
            size={formData.basicInfo?.squareFootage || 0}
            sizeUnit="sqft"
            imageSource={formData.media?.images && formData.media.images.length > 0 ? formData.media.images[0] : undefined}
            variant="default"
            showFavoriteButton={false}
            showVerifiedBadge={false}
            showTypeIcon={true}
            showFeatures={true}
            showPrice={true}
            showLocation={true}
            showRating={false}
            imageHeight={160}
            titleLines={2}
            locationLines={1}
            onPress={() => { }} // No action needed for preview
          />
        </View>

        {/* Sections */}
        {sections.map((section) => (
          <View key={section.id} style={styles.sectionContainer}>
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => toggleSection(section.id)}
              activeOpacity={0.7}
            >
              <View style={styles.sectionHeaderLeft}>
                <View
                  style={[styles.sectionIcon, section.isComplete && styles.sectionIconComplete]}
                >
                  <IconComponent
                    name={section.icon}
                    size={16}
                    color={section.isComplete ? colors.primaryLight : colors.COLOR_BLACK_LIGHT_3}
                  />
                </View>
                <ThemedText style={styles.sectionTitle}>{section.title}</ThemedText>
              </View>
              <View style={styles.sectionHeaderRight}>
                {section.hasData && (
                  <View
                    style={[
                      styles.completionIndicator,
                      section.isComplete && styles.completionIndicatorComplete,
                    ]}
                  >
                    <IconComponent
                      name={section.isComplete ? 'checkmark' : 'ellipse-outline'}
                      size={12}
                      color={section.isComplete ? colors.primaryLight : colors.COLOR_BLACK_LIGHT_3}
                    />
                  </View>
                )}
                <IconComponent
                  name={expandedSections.has(section.id) ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.COLOR_BLACK_LIGHT_3}
                />
              </View>
            </TouchableOpacity>

            {expandedSections.has(section.id) && (
              <View style={styles.sectionContent}>
                {section.id === 'basic' && (
                  <View style={styles.sectionData}>
                    {formData.basicInfo?.propertyType && (
                      <View style={styles.dataItem}>
                        <ThemedText style={styles.dataLabel}>Type:</ThemedText>
                        <ThemedText style={styles.dataValue}>{accommodationType}</ThemedText>
                      </View>
                    )}
                    {formData.basicInfo?.bedrooms !== undefined && (
                      <View style={styles.dataItem}>
                        <ThemedText style={styles.dataLabel}>Bedrooms:</ThemedText>
                        <ThemedText style={styles.dataValue}>
                          {formData.basicInfo.bedrooms}
                        </ThemedText>
                      </View>
                    )}
                    {formData.basicInfo?.bathrooms !== undefined && (
                      <View style={styles.dataItem}>
                        <ThemedText style={styles.dataLabel}>Bathrooms:</ThemedText>
                        <ThemedText style={styles.dataValue}>
                          {formData.basicInfo.bathrooms}
                        </ThemedText>
                      </View>
                    )}
                    {formData.basicInfo?.squareFootage && (
                      <View style={styles.dataItem}>
                        <ThemedText style={styles.dataLabel}>Square Footage:</ThemedText>
                        <ThemedText style={styles.dataValue}>
                          {formData.basicInfo.squareFootage} sqft
                        </ThemedText>
                      </View>
                    )}
                  </View>
                )}

                {section.id === 'location' && (
                  <View style={styles.sectionData}>
                    {formData.location?.city && (
                      <View style={styles.dataItem}>
                        <ThemedText style={styles.dataLabel}>City:</ThemedText>
                        <ThemedText style={styles.dataValue}>{formData.location.city}</ThemedText>
                      </View>
                    )}
                    {formData.location?.state && (
                      <View style={styles.dataItem}>
                        <ThemedText style={styles.dataLabel}>State:</ThemedText>
                        <ThemedText style={styles.dataValue}>{formData.location.state}</ThemedText>
                      </View>
                    )}
                    {formData.location?.zipCode && (
                      <View style={styles.dataItem}>
                        <ThemedText style={styles.dataLabel}>ZIP Code:</ThemedText>
                        <ThemedText style={styles.dataValue}>
                          {formData.location.zipCode}
                        </ThemedText>
                      </View>
                    )}
                  </View>
                )}

                {section.id === 'pricing' && (
                  <View style={styles.sectionData}>
                    {formData.pricing?.monthlyRent && formData.pricing.monthlyRent > 0 && (
                      <View style={styles.dataItem}>
                        <ThemedText style={styles.dataLabel}>Monthly Rent:</ThemedText>
                        <ThemedText style={styles.dataValue}>
                          ${formData.pricing.monthlyRent.toLocaleString()}
                        </ThemedText>
                      </View>
                    )}
                    {formData.pricing?.securityDeposit && formData.pricing.securityDeposit > 0 && (
                      <View style={styles.dataItem}>
                        <ThemedText style={styles.dataLabel}>Security Deposit:</ThemedText>
                        <ThemedText style={styles.dataValue}>
                          ${formData.pricing.securityDeposit.toLocaleString()}
                        </ThemedText>
                      </View>
                    )}
                    {formData.pricing?.currency && (
                      <View style={styles.dataItem}>
                        <ThemedText style={styles.dataLabel}>Currency:</ThemedText>
                        <ThemedText style={styles.dataValue}>
                          {formData.pricing.currency}
                        </ThemedText>
                      </View>
                    )}
                    {formData.pricing?.includedUtilities &&
                      formData.pricing.includedUtilities.length > 0 && (
                        <View style={styles.dataItem}>
                          <ThemedText style={styles.dataLabel}>Included Utilities:</ThemedText>
                          <ThemedText style={styles.dataValue}>
                            {formData.pricing.includedUtilities.join(', ')}
                          </ThemedText>
                        </View>
                      )}
                    {formData.pricing?.applicationFee && formData.pricing.applicationFee > 0 && (
                      <View style={styles.dataItem}>
                        <ThemedText style={styles.dataLabel}>Application Fee:</ThemedText>
                        <ThemedText style={styles.dataValue}>
                          ${formData.pricing.applicationFee.toLocaleString()}
                        </ThemedText>
                      </View>
                    )}
                    {formData.pricing?.lateFee && formData.pricing.lateFee > 0 && (
                      <View style={styles.dataItem}>
                        <ThemedText style={styles.dataLabel}>Late Fee:</ThemedText>
                        <ThemedText style={styles.dataValue}>
                          ${formData.pricing.lateFee.toLocaleString()}
                        </ThemedText>
                      </View>
                    )}
                  </View>
                )}

                {section.id === 'amenities' && (
                  <View style={styles.sectionData}>
                    {amenitiesDisplay.length > 0 && (
                      <View style={styles.amenitiesGrid}>
                        {amenitiesDisplay.map((amenity: string, index: number) => (
                          <View key={index} style={styles.amenityTag}>
                            <IconComponent
                              name="checkmark-circle"
                              size={12}
                              color={colors.primaryColor}
                            />
                            <ThemedText style={styles.amenityText}>{amenity}</ThemedText>
                          </View>
                        ))}
                        {formData.amenities?.selectedAmenities &&
                          formData.amenities.selectedAmenities.length > 6 && (
                            <ThemedText style={styles.moreAmenitiesText}>
                              +{formData.amenities.selectedAmenities.length - 6} more
                            </ThemedText>
                          )}
                      </View>
                    )}
                    {formData.rules?.petsAllowed !== undefined && (
                      <View style={styles.dataItem}>
                        <ThemedText style={styles.dataLabel}>Pet Friendly:</ThemedText>
                        <ThemedText style={styles.dataValue}>
                          {yesNo(formData.rules.petsAllowed)}
                        </ThemedText>
                      </View>
                    )}
                    {formData.rules?.smokingAllowed !== undefined && (
                      <View style={styles.dataItem}>
                        <ThemedText style={styles.dataLabel}>Smoking Allowed:</ThemedText>
                        <ThemedText style={styles.dataValue}>
                          {yesNo(formData.rules.smokingAllowed)}
                        </ThemedText>
                      </View>
                    )}
                    {formData.rules?.partiesAllowed !== undefined && (
                      <View style={styles.dataItem}>
                        <ThemedText style={styles.dataLabel}>Parties Allowed:</ThemedText>
                        <ThemedText style={styles.dataValue}>
                          {yesNo(formData.rules.partiesAllowed)}
                        </ThemedText>
                      </View>
                    )}
                    {formData.rules?.guestsAllowed !== undefined && (
                      <View style={styles.dataItem}>
                        <ThemedText style={styles.dataLabel}>Guests Allowed:</ThemedText>
                        <ThemedText style={styles.dataValue}>
                          {yesNo(formData.rules.guestsAllowed)}
                        </ThemedText>
                      </View>
                    )}
                  </View>
                )}

                {section.id === 'media' && (
                  <View style={styles.sectionData}>
                    <View style={styles.dataItem}>
                      <ThemedText style={styles.dataLabel}>Photos:</ThemedText>
                      <ThemedText style={styles.dataValue}>
                        {formData.media?.images ? formData.media.images.length : 0} uploaded
                      </ThemedText>
                    </View>
                  </View>
                )}

                {section.id === 'description' && (
                  <View style={styles.sectionData}>
                    {formData.basicInfo?.description ? (
                      <ThemedText style={styles.descriptionText} numberOfLines={4}>
                        {formData.basicInfo.description}
                      </ThemedText>
                    ) : (
                      <ThemedText style={styles.emptyDescriptionText}>
                        No description added yet
                      </ThemedText>
                    )}
                  </View>
                )}
              </View>
            )}
          </View>
        ))}

        {/* Publish Status */}
        <View style={styles.publishStatusContainer}>
          <View
            style={[
              styles.publishStatus,
              completionPercentage >= 80
                ? styles.publishStatusReady
                : styles.publishStatusIncomplete,
            ]}
          >
            <IconComponent
              name={completionPercentage >= 80 ? 'checkmark-circle' : 'alert-circle'}
              size={20}
              color={completionPercentage >= 80 ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_3}
            />
            <ThemedText
              style={[
                styles.publishStatusText,
                completionPercentage >= 80 && styles.publishStatusTextReady,
              ]}
            >
              {completionPercentage >= 80
                ? 'Ready to Publish'
                : `${100 - completionPercentage}% more to complete`}
            </ThemedText>
          </View>
        </View>
      </ScrollView>
    </BaseWidget>
  );
}

const styles = StyleSheet.create({
  typeBadge: {
    backgroundColor: colors.primaryColor,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primaryLight,
  },
  container: {
    // No max height constraint - allow full expansion
  },
  scrollContent: {
    paddingBottom: 20,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyIconContainer: {
    marginBottom: 16,
    opacity: 0.6,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
    lineHeight: 20,
  },
  progressContainer: {
    marginBottom: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  progressPercentage: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.primaryColor,
  },
  progressBar: {
    height: 6,
    backgroundColor: colors.COLOR_BLACK_LIGHT_4,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primaryColor,
    borderRadius: 3,
  },
  propertyCardContainer: {
    marginBottom: 20,
  },
  sectionContainer: {
    marginBottom: 12,
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.COLOR_BLACK_LIGHT_4,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  sectionIconComplete: {
    backgroundColor: colors.primaryColor,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    flex: 1,
  },
  completionIndicator: {
    marginRight: 8,
  },
  completionIndicatorComplete: {
    // Already styled by the icon color
  },
  sectionContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sectionData: {
    // Container for section data
  },
  dataItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
  },
  dataLabel: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontWeight: '500',
  },
  dataValue: {
    fontSize: 13,
    color: colors.COLOR_BLACK,
    fontWeight: '600',
    textAlign: 'right',
    flex: 1,
    marginLeft: 8,
  },
  amenitiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  amenityTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 8,
    marginBottom: 6,
  },
  amenityText: {
    fontSize: 12,
    color: colors.COLOR_BLACK,
    marginLeft: 4,
    fontWeight: '500',
  },
  moreAmenitiesText: {
    fontSize: 12,
    color: colors.primaryColor,
    fontStyle: 'italic',
    marginTop: 4,
  },
  descriptionText: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 18,
  },
  emptyDescriptionText: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontStyle: 'italic',
  },
  publishStatusContainer: {
    marginTop: 16,
    paddingHorizontal: 16,
  },
  publishStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
  },
  publishStatusReady: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryColor,
  },
  publishStatusIncomplete: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
  },
  publishStatusText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_3,
    marginLeft: 8,
  },
  publishStatusTextReady: {
    color: colors.primaryColor,
  },
});
