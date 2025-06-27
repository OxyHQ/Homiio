import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform, TextInput, Modal, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors } from '@/styles/colors';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { PropertyMap } from '@/components/PropertyMap';
import { ThemedText } from '@/components/ThemedText';
import { AmenitiesDisplay } from '@/components/AmenitiesDisplay';
import { CurrencyFormatter } from '@/components/CurrencyFormatter';
import { useProperty } from '@/hooks';
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
    priceUnit: 'day' | 'night' | 'week' | 'month' | 'year';
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
    images: string[];
};

const IconComponent = Ionicons as any;

export default function PropertyDetailPage() {
    const { t } = useTranslation();
    const router = useRouter();
    const { id } = useLocalSearchParams();
    const { oxyServices, activeSessionId } = useOxy();
    const { property: apiProperty, loading: isLoading, error, loadProperty } = useProperty(id as string);
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
        if (normalizedLandlordProfileId && oxyServices && activeSessionId) {
            dispatch(fetchLandlordProfileById({ profileId: normalizedLandlordProfileId, oxyServices, activeSessionId }));
        }
    }, [normalizedLandlordProfileId, oxyServices, activeSessionId, dispatch]);

    // Debug logging
    useEffect(() => {
        console.log('PropertyDetailPage Debug:', {
            id,
            apiProperty: !!apiProperty,
            isLoading,
            error: error,
            oxyServices: !!oxyServices,
            activeSessionId: !!activeSessionId
        });
    }, [id, apiProperty, isLoading, error, oxyServices, activeSessionId]);

    const property = useMemo<PropertyDetail | null>(() => {
        if (!apiProperty) return null;

        try {
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

            const price = apiProperty.rent
                ? `${currency}${apiProperty.rent.amount}/${priceUnit}`
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
                priceUnit,
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
            const propertyId = apiProperty._id || apiProperty.id;
            if (propertyId) {
                userApi.trackPropertyView(propertyId, oxyServices, activeSessionId)
                    .then(() => {
                        console.log('PropertyDetailPage: Successfully tracked property view in backend');
                        // Refresh recently viewed from backend to get the updated list
                        dispatch(fetchRecentlyViewedProperties({ oxyServices, activeSessionId }));
                    })
                    .catch((error) => {
                        console.error('PropertyDetailPage: Failed to track property view in backend:', error);
                    });
            }
        } else if (apiProperty && !hasViewedRef.current) {
            console.log('PropertyDetailPage: User not authenticated, skipping backend view tracking');
            hasViewedRef.current = true;

            // For unauthenticated users, only add to local Redux state
            dispatch(addPropertyToRecentlyViewed(apiProperty));
        }
    }, [apiProperty, oxyServices, activeSessionId, dispatch]);

    // Load property on component mount
    React.useEffect(() => {
        if (id) {
            loadProperty();
        }
    }, [id, loadProperty]);

    const handleContact = () => {
        // In a real app, this would open a chat with the landlord
        router.push(`/chat/${property?.id}`);
    };

    const handleScheduleViewing = () => {
        // In a real app, this would navigate to a booking screen
        router.push(`/properties/${property?.id}/book-viewing`);
    };

    const handleApply = () => {
        // For public housing, redirect to state website
        if (apiProperty?.housingType === 'public') {
            handlePublicHousingApply();
            return;
        }
        // In a real app, this would navigate to a rental application form
        router.push(`/properties/${property?.id}/apply`);
    };

    const handlePublicHousingApply = () => {
        // Get state from property address to redirect to appropriate website
        const state = (apiProperty?.address?.state || '').toLowerCase();

        // State-specific public housing websites (examples)
        const stateWebsites: { [key: string]: string } = {
            'california': 'https://www.hcd.ca.gov/grants-funding/active-funding/multifamily-housing-program',
            'new york': 'https://www.nyshcr.org/',
            'texas': 'https://www.tdhca.state.tx.us/',
            'florida': 'https://www.floridahousing.org/',
            // Add more states as needed
        };

        const websiteUrl = stateWebsites[state] || 'https://www.hud.gov/topics/rental_assistance/phprog';

        // Open external browser
        router.push(`/browser?url=${encodeURIComponent(websiteUrl)}`);
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
                            color="#222"
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
                        <Text style={styles.priceLabel}>
                            {property.priceUnit === 'day' ? t("Daily Rent") :
                                property.priceUnit === 'night' ? t("Nightly Rent") :
                                    property.priceUnit === 'week' ? t("Weekly Rent") :
                                        property.priceUnit === 'month' ? t("Monthly Rent") :
                                            property.priceUnit === 'year' ? t("Yearly Rent") :
                                                t("Rent")}
                        </Text>
                        <CurrencyFormatter
                            amount={parseFloat(property.price) || 0}
                            originalCurrency={apiProperty?.rent?.currency || 'USD'}
                            showConversion={true}
                        />
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

                    <AmenitiesDisplay amenities={property.amenities} title="" />

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

                    {/* Landlord Info / Government Housing Authority */}
                    <View style={styles.divider} />
                    <Text style={styles.sectionTitle}>
                        {apiProperty?.housingType === 'public' ? t("Housing Authority") : t("Landlord")}
                    </Text>
                    <View style={styles.landlordCard}>
                        {apiProperty?.housingType === 'public' ? (
                            <>
                                <View style={styles.landlordHeader}>
                                    <View style={[styles.landlordAvatar, styles.governmentAvatar]}>
                                        <IconComponent name="library" size={28} color="white" />
                                    </View>
                                    <View style={styles.landlordInfo}>
                                        <View style={styles.landlordNameRow}>
                                            <Text style={styles.landlordName}>
                                                {apiProperty?.address?.state ? `${apiProperty.address.state} Housing Authority` : 'Public Housing Authority'}
                                            </Text>
                                            <View style={[styles.verifiedBadge, styles.governmentBadge]}>
                                                <Text style={styles.verifiedText}>GOV</Text>
                                            </View>
                                        </View>
                                        <Text style={styles.landlordRating}>
                                            Government-managed affordable housing
                                        </Text>
                                    </View>
                                </View>
                                <View style={styles.landlordActions}>
                                    <TouchableOpacity style={[styles.messageButton, styles.governmentButton]} onPress={handlePublicHousingApply}>
                                        <IconComponent name="globe" size={16} color="white" />
                                        <Text style={styles.messageButtonText}>{t("Apply on State Website")}</Text>
                                    </TouchableOpacity>
                                </View>
                            </>
                        ) : (
                            <>
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
                                            {landlordProfile?.personalProfile?.trustScore?.score ? `Trust Score: ${landlordProfile.personalProfile.trustScore.score}` : 'No rating yet'}
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
                            </>
                        )}
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
                        {apiProperty?.housingType === 'public' ? (
                            <>
                                <TouchableOpacity style={[styles.scheduleButton, styles.disabledButton]} disabled>
                                    <Text style={[styles.scheduleButtonText, styles.disabledText]}>{t("Contact Housing Authority")}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.applyButton, styles.governmentApplyButton]} onPress={handleApply}>
                                    <IconComponent name="globe" size={16} color="white" />
                                    <Text style={styles.applyButtonText}>{t("Apply on State Website")}</Text>
                                </TouchableOpacity>
                            </>
                        ) : (
                            <>
                                <TouchableOpacity style={styles.scheduleButton} onPress={handleScheduleViewing}>
                                    <Text style={styles.scheduleButtonText}>{t("Schedule Viewing")}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.applyButton} onPress={handleApply}>
                                    <Text style={styles.applyButtonText}>{t("Apply Now")}</Text>
                                </TouchableOpacity>
                            </>
                        )}
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
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    loadingText: {
        marginTop: 10,
        fontSize: 16,
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
    enhancedHeader: {
        backgroundColor: colors.primaryLight,
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    headerTitle: {
        fontSize: 24,
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
    infoContainer: {
        padding: 20,
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
    governmentAvatar: {
        backgroundColor: '#1E40AF',
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
    governmentBadge: {
        backgroundColor: '#1E40AF',
        paddingHorizontal: 8,
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
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    governmentButton: {
        backgroundColor: '#1E40AF',
        marginRight: 0,
        gap: 8,
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
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 8,
    },
    governmentApplyButton: {
        backgroundColor: '#1E40AF',
    },
    disabledButton: {
        backgroundColor: '#E5E7EB',
    },
    disabledText: {
        color: '#9CA3AF',
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
}); 