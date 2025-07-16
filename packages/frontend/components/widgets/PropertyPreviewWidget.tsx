import React from 'react';
import { View, StyleSheet, Image, Dimensions, ScrollView } from 'react-native';
import { colors } from '@/styles/colors';
import { ThemedText } from '../ThemedText';
import { Ionicons } from '@expo/vector-icons';
import { BaseWidget } from './BaseWidget';
import { useCreatePropertyFormStore } from '@/store/createPropertyFormStore';

const IconComponent = Ionicons as any;

export function PropertyPreviewWidget() {
    const { formData } = useCreatePropertyFormStore();

    if (!formData) {
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

    const generatePropertyTitle = () => {
        const { propertyType, bedrooms, bathrooms } = formData.basicInfo;
        const { city } = formData.location;
        if (!propertyType || !city) return 'Property Preview';
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
    };

    const getPriceDisplay = () => {
        return `$${formData.pricing.rent.toLocaleString()}/month`;
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
        return typeLabels[formData.basicInfo.propertyType] || 'Property';
    };

    const getAmenitiesDisplay = () => {
        if (!formData.amenities.features || formData.amenities.features.length === 0) return [];
        return formData.amenities.features.slice(0, 6).map((amenity: string) => {
            const amenityData = getAmenityById(amenity);
            return amenityData?.name || amenity;
        });
    };

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

    const yesNo = (val?: boolean) => val === true ? 'Yes' : val === false ? 'No' : '-';

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
                {formData.media.images && formData.media.images.length > 0 ? (
                    <View style={styles.placeholderImage}>
                        <IconComponent name="home-outline" size={32} color={colors.COLOR_BLACK_LIGHT_3} />
                        <ThemedText style={styles.placeholderText}>Image selected ({formData.media.images.length})</ThemedText>
                    </View>
                ) : (
                    <View style={styles.placeholderImage}>
                        <IconComponent name="home-outline" size={32} color={colors.COLOR_BLACK_LIGHT_3} />
                        <ThemedText style={styles.placeholderText}>Add photos to see preview</ThemedText>
                    </View>
                )}

                <View style={styles.previewContent}>
                    <ThemedText style={styles.propertyTitle} numberOfLines={2}>
                        {generatePropertyTitle()}
                    </ThemedText>

                    {formData.location.city && (
                        <ThemedText style={styles.propertyLocation}>
                            {formData.location.city}, {formData.location.state}
                        </ThemedText>
                    )}

                    <View style={styles.propertyDetails}>
                        {(formData.basicInfo.bedrooms || formData.basicInfo.bedrooms === 0) && (
                            <View style={styles.detailItem}>
                                <IconComponent name="bed-outline" size={14} color={colors.COLOR_BLACK_LIGHT_3} />
                                <ThemedText style={styles.detailText}>{formData.basicInfo.bedrooms} bed</ThemedText>
                            </View>
                        )}
                        {(formData.basicInfo.bathrooms || formData.basicInfo.bathrooms === 0) && (
                            <View style={styles.detailItem}>
                                <IconComponent name="water-outline" size={14} color={colors.COLOR_BLACK_LIGHT_3} />
                                <ThemedText style={styles.detailText}>{formData.basicInfo.bathrooms} bath</ThemedText>
                            </View>
                        )}
                        {formData.basicInfo.squareFootage && formData.basicInfo.squareFootage > 0 && (
                            <View style={styles.detailItem}>
                                <IconComponent name="resize-outline" size={14} color={colors.COLOR_BLACK_LIGHT_3} />
                                <ThemedText style={styles.detailText}>{formData.basicInfo.squareFootage} sqft</ThemedText>
                            </View>
                        )}
                    </View>

                    {formData.pricing.rent > 0 && (
                        <View style={styles.priceContainer}>
                            <ThemedText style={styles.price}>{getPriceDisplay()}</ThemedText>
                            {formData.pricing.deposit > 0 && (
                                <ThemedText style={styles.depositText}>
                                    Deposit: ${formData.pricing.deposit.toLocaleString()}
                                </ThemedText>
                            )}
                            {formData.pricing.utilities && formData.pricing.utilities.length > 0 && (
                                <ThemedText style={styles.utilitiesText}>
                                    Utilities: {formData.pricing.utilities.join(', ')}
                                </ThemedText>
                            )}
                        </View>
                    )}

                    <View style={styles.featuresContainer}>
                        <View style={styles.sectionHeader}>
                            <IconComponent name="star-outline" size={16} color={colors.primaryColor} />
                            <ThemedText style={styles.sectionTitle}>Features</ThemedText>
                        </View>
                        <View style={styles.featuresGrid}>
                            {formData.amenities.furnished && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Furnished</ThemedText>
                                </View>
                            )}
                            {formData.amenities.pets && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Pet Friendly</ThemedText>
                                </View>
                            )}
                            {formData.amenities.parking && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Parking: {formData.amenities.parking}</ThemedText>
                                </View>
                            )}
                        </View>
                    </View>

                    {formData.amenities.features && formData.amenities.features.length > 0 && (
                        <View style={styles.amenitiesContainer}>
                            <View style={styles.sectionHeader}>
                                <IconComponent name="list-outline" size={16} color={colors.primaryColor} />
                                <ThemedText style={styles.sectionTitle}>Amenities</ThemedText>
                            </View>
                            <View style={styles.amenitiesGrid}>
                                {getAmenitiesDisplay().map((amenity: string, index: number) => (
                                    <View key={index} style={styles.amenityItem}>
                                        <IconComponent name="checkmark-circle" size={12} color={colors.primaryColor} />
                                        <ThemedText style={styles.amenityText}>{amenity}</ThemedText>
                                    </View>
                                ))}
                                {formData.amenities.features.length > 6 && (
                                    <ThemedText style={styles.moreAmenitiesText}>
                                        +{formData.amenities.features.length - 6} more
                                    </ThemedText>
                                )}
                            </View>
                        </View>
                    )}

                    {formData.basicInfo.description && (
                        <View style={styles.descriptionContainer}>
                            <View style={styles.sectionHeader}>
                                <IconComponent name="document-text-outline" size={16} color={colors.primaryColor} />
                                <ThemedText style={styles.sectionTitle}>Description</ThemedText>
                            </View>
                            <ThemedText style={styles.descriptionText} numberOfLines={4}>
                                {formData.basicInfo.description}
                            </ThemedText>
                        </View>
                    )}

                    <View style={styles.statusContainer}>
                        <View style={styles.statusIndicator}>
                            <ThemedText style={styles.statusText}>
                                Ready to Publish
                            </ThemedText>
                        </View>
                    </View>

                    {/* --- Advanced Features Section --- */}
                    <View style={styles.featuresContainer}>
                        <View style={styles.sectionHeader}>
                            <IconComponent name="settings-outline" size={16} color={colors.primaryColor} />
                            <ThemedText style={styles.sectionTitle}>Advanced Features</ThemedText>
                        </View>
                        <View style={styles.featuresGrid}>
                            {formData.basicInfo.floor !== undefined && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Floor: {formData.basicInfo.floor}</ThemedText>
                                </View>
                            )}
                            {formData.basicInfo.yearBuilt !== undefined && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Year Built: {formData.basicInfo.yearBuilt}</ThemedText>
                                </View>
                            )}
                            {formData.amenities.parkingType && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Parking Type: {formData.amenities.parkingType}</ThemedText>
                                </View>
                            )}
                            {formData.amenities.parkingSpaces !== undefined && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Parking Spaces: {formData.amenities.parkingSpaces}</ThemedText>
                                </View>
                            )}
                        </View>
                    </View>

                    {/* --- Policy & Rules Section --- */}
                    <View style={styles.featuresContainer}>
                        <View style={styles.sectionHeader}>
                            <IconComponent name="alert-circle-outline" size={16} color={colors.primaryColor} />
                            <ThemedText style={styles.sectionTitle}>Policies & Rules</ThemedText>
                        </View>
                        <View style={styles.featuresGrid}>
                            {formData.amenities.petPolicy && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Pet Policy: {formData.amenities.petPolicy}</ThemedText>
                                </View>
                            )}
                            {formData.amenities.petFee !== undefined && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Pet Fee: ${formData.amenities.petFee}</ThemedText>
                                </View>
                            )}
                            <View style={styles.featureTag}>
                                <ThemedText style={styles.featureText}>Smoking Allowed: {yesNo(formData.amenities.smokingAllowed)}</ThemedText>
                            </View>
                            <View style={styles.featureTag}>
                                <ThemedText style={styles.featureText}>Parties Allowed: {yesNo(formData.amenities.partiesAllowed)}</ThemedText>
                            </View>
                            <View style={styles.featureTag}>
                                <ThemedText style={styles.featureText}>Guests Allowed: {yesNo(formData.pricing.guestsAllowed)}</ThemedText>
                            </View>
                            {formData.pricing.maxGuests !== undefined && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Max Guests: {formData.pricing.maxGuests}</ThemedText>
                                </View>
                            )}
                        </View>
                    </View>

                    {/* --- Availability Section --- */}
                    <View style={styles.featuresContainer}>
                        <View style={styles.sectionHeader}>
                            <IconComponent name="calendar-outline" size={16} color={colors.primaryColor} />
                            <ThemedText style={styles.sectionTitle}>Availability</ThemedText>
                        </View>
                        <View style={styles.featuresGrid}>
                            {formData.location.availableFrom && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Available From: {formData.location.availableFrom}</ThemedText>
                                </View>
                            )}
                            {formData.location.leaseTerm && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Lease Term: {formData.location.leaseTerm}</ThemedText>
                                </View>
                            )}
                        </View>
                    </View>

                    {/* --- Location Intelligence Section --- */}
                    <View style={styles.featuresContainer}>
                        <View style={styles.sectionHeader}>
                            <IconComponent name="map-outline" size={16} color={colors.primaryColor} />
                            <ThemedText style={styles.sectionTitle}>Location Intelligence</ThemedText>
                        </View>
                        <View style={styles.featuresGrid}>
                            {formData.location.walkScore !== undefined && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Walk Score: {formData.location.walkScore}</ThemedText>
                                </View>
                            )}
                            {formData.location.transitScore !== undefined && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Transit Score: {formData.location.transitScore}</ThemedText>
                                </View>
                            )}
                            {formData.location.bikeScore !== undefined && (
                                <View style={styles.featureTag}>
                                    <ThemedText style={styles.featureText}>Bike Score: {formData.location.bikeScore}</ThemedText>
                                </View>
                            )}
                            <View style={styles.featureTag}>
                                <ThemedText style={styles.featureText}>Near Transport: {yesNo(formData.location.proximityToTransport)}</ThemedText>
                            </View>
                            <View style={styles.featureTag}>
                                <ThemedText style={styles.featureText}>Near Schools: {yesNo(formData.location.proximityToSchools)}</ThemedText>
                            </View>
                            <View style={styles.featureTag}>
                                <ThemedText style={styles.featureText}>Near Shopping: {yesNo(formData.location.proximityToShopping)}</ThemedText>
                            </View>
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