import React from 'react';
import { View, StyleSheet, Image, Dimensions, ScrollView } from 'react-native';
import { colors } from '@/styles/colors';
import { ThemedText } from '../ThemedText';
import { Ionicons } from '@expo/vector-icons';
import { BaseWidget } from './BaseWidget';
import { useSelector } from 'react-redux';
import { RootState } from '@/store/store';

const IconComponent = Ionicons as any;
const { width: screenWidth } = Dimensions.get('window');

export function PropertyPreviewWidget() {
    // Only show on desktop (tablet and larger screens)
    if (screenWidth < 768) {
        console.log('PropertyPreviewWidget: Screen too small, not showing');
        return null;
    }

    // Get form data from Redux
    const { formData, isVisible } = useSelector((state: RootState) => state.createPropertyForm);

    // Debug logging
    console.log('PropertyPreviewWidget Debug:', {
        screenWidth,
        formData: !!formData,
        isVisible,
        formDataKeys: formData ? Object.keys(formData) : [],
        address: formData?.address,
        type: formData?.type,
        rent: formData?.rent,
        reduxState: useSelector((state: RootState) => state.createPropertyForm)
    });

    // Always show the widget for debugging, even without form data
    console.log('PropertyPreviewWidget: Rendering widget');

    // For testing - show widget even without form data
    if (!formData) {
        console.log('PropertyPreviewWidget: Showing test widget without form data');
        return (
            <BaseWidget
                title="Live Preview"
                icon={
                    <View style={styles.typeBadge}>
                        <ThemedText style={styles.typeBadgeText}>Test</ThemedText>
                    </View>
                }
            >
                <View style={styles.container}>
                    <View style={styles.placeholderImage}>
                        <IconComponent name="home-outline" size={32} color={colors.COLOR_BLACK_LIGHT_3} />
                        <ThemedText style={styles.placeholderText}>No form data yet</ThemedText>
                    </View>
                    <View style={styles.previewContent}>
                        <ThemedText style={styles.propertyTitle}>Property Preview</ThemedText>
                        <ThemedText style={styles.propertyLocation}>Start filling the form to see preview</ThemedText>
                        <ThemedText style={styles.debugText}>Debug: Widget is rendering</ThemedText>
                    </View>
                </View>
            </BaseWidget>
        );
    }

    // Don't show if not visible
    if (!isVisible) {
        console.log('PropertyPreviewWidget: Not showing - not visible');
        return null;
    }

    console.log('PropertyPreviewWidget: Rendering with data');

    const generatePropertyTitle = () => {
        const { type, address, bedrooms, bathrooms } = formData;

        if (!type || !address?.city) return 'Property Preview';

        const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
        const location = address.city;

        if (type === 'room') {
            return `${bedrooms} Bedroom Room in ${location}`;
        } else if (type === 'studio') {
            return `Studio in ${location}`;
        } else if (type === 'apartment') {
            return `${bedrooms} Bedroom Apartment in ${location}`;
        } else if (type === 'house') {
            return `${bedrooms} Bedroom House in ${location}`;
        } else {
            return `${typeLabel} in ${location}`;
        }
    };

    const getPriceDisplay = () => {
        if (formData.type === 'couchsurfing') {
            return formData.rent.amount > 0 ? `$${formData.rent.amount}/night` : 'Free';
        }
        return `$${formData.rent.amount.toLocaleString()}/month`;
    };

    const getAccommodationTypeLabel = () => {
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
            other: 'Other'
        };
        return typeLabels[formData.type] || 'Property';
    };

    const getAmenitiesDisplay = () => {
        if (!formData.amenities || formData.amenities.length === 0) return [];

        return formData.amenities.slice(0, 6).map(amenity => {
            const amenityData = getAmenityById(amenity);
            return amenityData?.name || amenity;
        });
    };

    const getAmenityById = (id: string) => {
        // This would come from your amenities constants
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

    return (
        <BaseWidget
            title="Live Preview"
            icon={
                <View style={styles.typeBadge}>
                    <ThemedText style={styles.typeBadgeText}>{getAccommodationTypeLabel()}</ThemedText>
                </View>
            }
        >
            <View style={styles.container}>
                {/* Property Image */}
                {formData.images.length > 0 ? (
                    <Image
                        source={{ uri: formData.images[formData.coverImageIndex] }}
                        style={styles.previewImage}
                        resizeMode="cover"
                    />
                ) : (
                    <View style={styles.placeholderImage}>
                        <IconComponent name="home-outline" size={32} color={colors.COLOR_BLACK_LIGHT_3} />
                        <ThemedText style={styles.placeholderText}>Add photos to see preview</ThemedText>
                    </View>
                )}

                {/* Property Content */}
                <View style={styles.previewContent}>
                    {/* Title */}
                    <ThemedText style={styles.propertyTitle} numberOfLines={2}>
                        {generatePropertyTitle()}
                    </ThemedText>

                    {/* Location */}
                    {formData.address?.city && (
                        <ThemedText style={styles.propertyLocation}>
                            {formData.address.city}, {formData.address.state}
                        </ThemedText>
                    )}

                    {/* Property Details */}
                    <View style={styles.propertyDetails}>
                        {(formData.bedrooms || formData.bedrooms === 0) && (
                            <View style={styles.detailItem}>
                                <IconComponent name="bed-outline" size={14} color={colors.COLOR_BLACK_LIGHT_3} />
                                <ThemedText style={styles.detailText}>{formData.bedrooms} bed</ThemedText>
                            </View>
                        )}
                        {(formData.bathrooms || formData.bathrooms === 0) && (
                            <View style={styles.detailItem}>
                                <IconComponent name="water-outline" size={14} color={colors.COLOR_BLACK_LIGHT_3} />
                                <ThemedText style={styles.detailText}>{formData.bathrooms} bath</ThemedText>
                            </View>
                        )}
                        {formData.squareFootage && formData.squareFootage > 0 && (
                            <View style={styles.detailItem}>
                                <IconComponent name="resize-outline" size={14} color={colors.COLOR_BLACK_LIGHT_3} />
                                <ThemedText style={styles.detailText}>{formData.squareFootage} sqft</ThemedText>
                            </View>
                        )}
                        {formData.floor && (
                            <View style={styles.detailItem}>
                                <IconComponent name="layers-outline" size={14} color={colors.COLOR_BLACK_LIGHT_3} />
                                <ThemedText style={styles.detailText}>Floor {formData.floor}</ThemedText>
                            </View>
                        )}
                    </View>

                    {/* Price */}
                    {formData.rent?.amount > 0 && (
                        <View style={styles.priceContainer}>
                            <ThemedText style={styles.price}>{getPriceDisplay()}</ThemedText>
                            {formData.rent.deposit && formData.rent.deposit > 0 && (
                                <ThemedText style={styles.depositText}>
                                    Deposit: ${formData.rent.deposit.toLocaleString()}
                                </ThemedText>
                            )}
                            {formData.rent.utilities && formData.rent.utilities !== 'excluded' && (
                                <ThemedText style={styles.utilitiesText}>
                                    Utilities: {formData.rent.utilities === 'included' ? 'Included' : 'Partial'}
                                </ThemedText>
                            )}
                        </View>
                    )}

                    {/* Availability */}
                    {formData.availableFrom && (
                        <View style={styles.availabilityContainer}>
                            <View style={styles.sectionHeader}>
                                <IconComponent name="calendar-outline" size={16} color={colors.primaryColor} />
                                <ThemedText style={styles.sectionTitle}>Availability</ThemedText>
                            </View>
                            <ThemedText style={styles.availabilityText}>
                                Available from: {new Date(formData.availableFrom).toLocaleDateString()}
                            </ThemedText>
                            {formData.leaseTerm && (
                                <ThemedText style={styles.leaseText}>
                                    Lease: {formData.leaseTerm === '6_months' ? '6 Months' :
                                        formData.leaseTerm === '12_months' ? '12 Months' :
                                            formData.leaseTerm === 'monthly' ? 'Monthly' : 'Flexible'}
                                </ThemedText>
                            )}
                        </View>
                    )}

                    {/* Features */}
                    <View style={styles.featuresContainer}>
                        <View style={styles.sectionHeader}>
                            <IconComponent name="star-outline" size={16} color={colors.primaryColor} />
                            <ThemedText style={styles.sectionTitle}>Features</ThemedText>
                        </View>
                        <View style={styles.featuresGrid}>
                            {formData.furnishedStatus === 'furnished' && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Furnished</ThemedText>
                                </View>
                            )}
                            {formData.furnishedStatus === 'partially_furnished' && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Partially Furnished</ThemedText>
                                </View>
                            )}
                            {formData.petPolicy === 'allowed' && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Pet Friendly</ThemedText>
                                </View>
                            )}
                            {formData.parkingType && formData.parkingType !== 'none' && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Parking</ThemedText>
                                </View>
                            )}
                            {formData.hasBalcony && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Balcony</ThemedText>
                                </View>
                            )}
                            {formData.hasGarden && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Garden</ThemedText>
                                </View>
                            )}
                            {formData.hasElevator && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Elevator</ThemedText>
                                </View>
                            )}
                        </View>
                    </View>

                    {/* Amenities */}
                    {formData.amenities && formData.amenities.length > 0 && (
                        <View style={styles.amenitiesContainer}>
                            <View style={styles.sectionHeader}>
                                <IconComponent name="list-outline" size={16} color={colors.primaryColor} />
                                <ThemedText style={styles.sectionTitle}>Amenities</ThemedText>
                            </View>
                            <View style={styles.amenitiesGrid}>
                                {getAmenitiesDisplay().map((amenity, index) => (
                                    <View key={index} style={styles.amenityItem}>
                                        <IconComponent name="checkmark-circle" size={12} color={colors.primaryColor} />
                                        <ThemedText style={styles.amenityText}>{amenity}</ThemedText>
                                    </View>
                                ))}
                                {formData.amenities.length > 6 && (
                                    <ThemedText style={styles.moreAmenitiesText}>
                                        +{formData.amenities.length - 6} more
                                    </ThemedText>
                                )}
                            </View>
                        </View>
                    )}

                    {/* House Rules */}
                    {(formData.smokingAllowed !== undefined || formData.partiesAllowed !== undefined ||
                        formData.guestsAllowed !== undefined || formData.maxGuests) && (
                            <View style={styles.rulesContainer}>
                                <View style={styles.sectionHeader}>
                                    <IconComponent name="shield-outline" size={16} color={colors.primaryColor} />
                                    <ThemedText style={styles.sectionTitle}>House Rules</ThemedText>
                                </View>
                                <View style={styles.rulesList}>
                                    {formData.smokingAllowed !== undefined && (
                                        <View style={styles.ruleItem}>
                                            <IconComponent
                                                name={formData.smokingAllowed ? "checkmark-circle" : "close-circle"}
                                                size={14}
                                                color={formData.smokingAllowed ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_3}
                                            />
                                            <ThemedText style={styles.ruleText}>Smoking {formData.smokingAllowed ? 'Allowed' : 'Not Allowed'}</ThemedText>
                                        </View>
                                    )}
                                    {formData.partiesAllowed !== undefined && (
                                        <View style={styles.ruleItem}>
                                            <IconComponent
                                                name={formData.partiesAllowed ? "checkmark-circle" : "close-circle"}
                                                size={14}
                                                color={formData.partiesAllowed ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_3}
                                            />
                                            <ThemedText style={styles.ruleText}>Parties {formData.partiesAllowed ? 'Allowed' : 'Not Allowed'}</ThemedText>
                                        </View>
                                    )}
                                    {formData.guestsAllowed !== undefined && (
                                        <View style={styles.ruleItem}>
                                            <IconComponent
                                                name={formData.guestsAllowed ? "checkmark-circle" : "close-circle"}
                                                size={14}
                                                color={formData.guestsAllowed ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_3}
                                            />
                                            <ThemedText style={styles.ruleText}>Guests {formData.guestsAllowed ? 'Allowed' : 'Not Allowed'}</ThemedText>
                                        </View>
                                    )}
                                    {formData.maxGuests && formData.maxGuests > 0 && (
                                        <View style={styles.ruleItem}>
                                            <IconComponent name="people-outline" size={14} color={colors.primaryColor} />
                                            <ThemedText style={styles.ruleText}>Max {formData.maxGuests} guests</ThemedText>
                                        </View>
                                    )}
                                </View>
                            </View>
                        )}

                    {/* Accommodation-specific details */}
                    {formData.accommodationDetails && (
                        <View style={styles.accommodationDetails}>
                            <View style={styles.sectionHeader}>
                                <IconComponent name="heart-outline" size={16} color={colors.primaryColor} />
                                <ThemedText style={styles.sectionTitle}>Special Features</ThemedText>
                            </View>
                            <View style={styles.specialFeaturesList}>
                                {formData.accommodationDetails.culturalExchange && (
                                    <View style={styles.specialFeature}>
                                        <IconComponent name="heart-outline" size={14} color={colors.primaryColor} />
                                        <ThemedText style={styles.specialFeatureText}>Cultural Exchange</ThemedText>
                                    </View>
                                )}
                                {formData.accommodationDetails.mealsIncluded && (
                                    <View style={styles.specialFeature}>
                                        <IconComponent name="restaurant-outline" size={14} color={colors.primaryColor} />
                                        <ThemedText style={styles.specialFeatureText}>Meals Included</ThemedText>
                                    </View>
                                )}
                                {formData.accommodationDetails.languages && formData.accommodationDetails.languages.length > 0 && (
                                    <View style={styles.specialFeature}>
                                        <IconComponent name="language-outline" size={14} color={colors.primaryColor} />
                                        <ThemedText style={styles.specialFeatureText}>
                                            {formData.accommodationDetails.languages.slice(0, 2).join(', ')}
                                            {formData.accommodationDetails.languages.length > 2 && ' +'}
                                        </ThemedText>
                                    </View>
                                )}
                                {formData.accommodationDetails.maxStay && (
                                    <View style={styles.specialFeature}>
                                        <IconComponent name="time-outline" size={14} color={colors.primaryColor} />
                                        <ThemedText style={styles.specialFeatureText}>
                                            Max stay: {formData.accommodationDetails.maxStay} days
                                        </ThemedText>
                                    </View>
                                )}
                                {formData.accommodationDetails.sleepingArrangement && (
                                    <View style={styles.specialFeature}>
                                        <IconComponent name="bed-outline" size={14} color={colors.primaryColor} />
                                        <ThemedText style={styles.specialFeatureText}>
                                            {formData.accommodationDetails.sleepingArrangement.replace('_', ' ')}
                                        </ThemedText>
                                    </View>
                                )}
                            </View>
                        </View>
                    )}

                    {/* Description Preview */}
                    {formData.description && (
                        <View style={styles.descriptionContainer}>
                            <View style={styles.sectionHeader}>
                                <IconComponent name="document-text-outline" size={16} color={colors.primaryColor} />
                                <ThemedText style={styles.sectionTitle}>Description</ThemedText>
                            </View>
                            <ThemedText style={styles.descriptionText} numberOfLines={4}>
                                {formData.description}
                            </ThemedText>
                        </View>
                    )}

                    {/* Status Indicator */}
                    <View style={styles.statusContainer}>
                        <View style={styles.statusIndicator}>
                            <ThemedText style={styles.statusText}>
                                {formData.isDraft ? 'Draft' : 'Ready to Publish'}
                            </ThemedText>
                        </View>
                    </View>
                </View>
            </View>
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
        marginVertical: 5,
        flex: 0,
    },
    previewImage: {
        width: '100%',
        height: 140,
        borderRadius: 8,
        marginBottom: 12,
    },
    placeholderImage: {
        width: '100%',
        height: 140,
        backgroundColor: colors.COLOR_BLACK_LIGHT_4,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 8,
        marginBottom: 12,
    },
    placeholderText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginTop: 8,
    },
    previewContent: {
        padding: 0,
    },
    propertyTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: colors.COLOR_BLACK,
        marginBottom: 4,
    },
    propertyLocation: {
        fontSize: 13,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginBottom: 10,
    },
    propertyDetails: {
        flexDirection: 'row',
        marginBottom: 10,
        flexWrap: 'wrap',
    },
    detailItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 12,
        marginBottom: 4,
    },
    detailText: {
        fontSize: 13,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginLeft: 4,
    },
    priceContainer: {
        marginBottom: 15,
        padding: 10,
        backgroundColor: colors.primaryLight,
        borderRadius: 8,
    },
    price: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.COLOR_BLACK,
        marginBottom: 4,
    },
    depositText: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginBottom: 2,
    },
    utilitiesText: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    availabilityContainer: {
        marginBottom: 15,
        padding: 10,
        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
        borderRadius: 8,
    },
    availabilityText: {
        fontSize: 13,
        color: colors.COLOR_BLACK,
        marginBottom: 2,
    },
    leaseText: {
        fontSize: 13,
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    featuresContainer: {
        marginBottom: 15,
    },
    amenitiesContainer: {
        marginBottom: 15,
    },
    rulesContainer: {
        marginBottom: 15,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
        marginLeft: 6,
    },
    featuresGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    featureTag: {
        backgroundColor: colors.primaryLight,
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: 6,
        marginRight: 5,
        marginBottom: 5,
    },
    featureText: {
        fontSize: 11,
        color: colors.COLOR_BLACK,
    },
    amenitiesGrid: {
        flexDirection: 'column',
    },
    amenityItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    amenityText: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginLeft: 6,
    },
    moreAmenitiesText: {
        fontSize: 12,
        color: colors.primaryColor,
        fontStyle: 'italic',
        marginTop: 4,
    },
    rulesList: {
        flexDirection: 'column',
    },
    ruleItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    ruleText: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginLeft: 6,
    },
    accommodationDetails: {
        marginBottom: 15,
    },
    specialFeaturesList: {
        flexDirection: 'column',
    },
    specialFeature: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    specialFeatureText: {
        fontSize: 13,
        color: colors.primaryColor,
        marginLeft: 6,
        fontWeight: '500',
    },
    descriptionContainer: {
        marginBottom: 15,
    },
    descriptionText: {
        fontSize: 13,
        color: colors.COLOR_BLACK_LIGHT_3,
        lineHeight: 18,
    },
    statusContainer: {
        alignItems: 'center',
        marginTop: 10,
    },
    statusIndicator: {
        backgroundColor: colors.primaryLight,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: {
        fontSize: 11,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
    },
    debugText: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginTop: 4,
    },
}); 