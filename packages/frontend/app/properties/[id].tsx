import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, Modal, Image, Share, Animated } from 'react-native';
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
import * as Clipboard from 'expo-clipboard';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { PropertyType, RecentlyViewedType, PropertyImage } from '@homiio/shared-types';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { getPropertyImageSource } from '@/utils/propertyUtils';

import { useProfileStore } from '@/store/profileStore';
import { useRecentlyViewedStore } from '@/store/recentlyViewedStore';
import { useFavorites } from '@/hooks/useFavorites';
import { userApi } from '@/utils/api';
import { SaveButton } from '@/components/SaveButton';
import { ActionButton } from '@/components/ui/ActionButton';
import Button from '@/components/Button';
import type { Profile } from '@/services/profileService';
import profileService from '@/services/profileService';
import { SindiIcon } from '@/assets/icons';
import { LinearGradient } from 'expo-linear-gradient';

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
    images: string[] | PropertyImage[];
};

const IconComponent = Ionicons as any;

export default function PropertyDetailPage() {
    const { t } = useTranslation();
    const router = useRouter();
    const { id } = useLocalSearchParams();
    const { oxyServices, activeSessionId } = useOxy();
    
    // Safe translation helper to prevent undefined/empty string issues
    const safeT = (key: string, fallback?: string) => {
        const translated = t(key);
        return translated || fallback || key;
    };
    
    const { property: apiProperty, loading: isLoading, error, loadProperty } = useProperty(id as string);
    const [activeImageIndex, setActiveImageIndex] = useState(0);
    const hasViewedRef = useRef(false);
    const scrollY = new Animated.Value(0);
    const [showPhotoGallery, setShowPhotoGallery] = useState(false);

    // Zustand stores
    const { items: recentlyViewed, addItem } = useRecentlyViewedStore();

    // Favorites (now Zustand-based)
    const { isFavorite, toggleFavorite, isPropertySaving } = useFavorites();

    // TODO: Implement landlord profile fetching with Zustand
    // For now, we'll use placeholder values
    const [landlordProfile, setLandlordProfile] = useState<Profile | null>(null);

    // Normalize landlordProfileId to string if it's an object (MongoDB $oid)
    let normalizedLandlordProfileId: string | undefined = undefined;
    if (apiProperty?.profileId) {
        if (typeof apiProperty.profileId === 'object' && apiProperty.profileId && '$oid' in apiProperty.profileId) {
            normalizedLandlordProfileId = (apiProperty.profileId as any).$oid;
        } else if (typeof apiProperty.profileId === 'string') {
            normalizedLandlordProfileId = apiProperty.profileId;
        }
    }

    // Fetch landlord profile
    useEffect(() => {
        const fetchLandlordProfile = async () => {
            if (normalizedLandlordProfileId && oxyServices && activeSessionId) {
                try {
                    const profile = await profileService.getProfileById(normalizedLandlordProfileId, oxyServices, activeSessionId);
                    setLandlordProfile(profile);
                } catch (error) {
                    console.error('Error fetching landlord profile:', error);
                    setLandlordProfile(null);
                }
            }
        };

        fetchLandlordProfile();
    }, [normalizedLandlordProfileId, oxyServices, activeSessionId]);

    // Helper function to safely get landlord display name
    const getLandlordDisplayName = (profile: Profile | null): string => {
        if (!profile) return '?';

        switch (profile.profileType) {
            case 'personal':
                return profile.personalProfile?.personalInfo?.bio || profile.oxyUserId || '?';
            case 'agency':
                return profile.agencyProfile?.legalCompanyName || profile.oxyUserId || '?';
            case 'business':
                return profile.businessProfile?.legalCompanyName || profile.oxyUserId || '?';
            case 'cooperative':
                return profile.cooperativeProfile?.legalName || profile.oxyUserId || '?';
            default:
                return profile.oxyUserId || '?';
        }
    };

    // Helper function to safely get landlord trust score
    const getLandlordTrustScore = (profile: Profile | null): string => {
        if (!profile || profile.profileType !== 'personal') return 'No rating yet';
        return profile.personalProfile?.trustScore?.score ? `Trust Score: ${profile.personalProfile.trustScore.score}` : 'No rating yet';
    };

    // Debug logging
    useEffect(() => {
        console.log('PropertyDetailPage Debug:', {
            id,
            apiProperty: !!apiProperty,
            isLoading,
            error: error,
            oxyServices: !!oxyServices,
            activeSessionId: !!activeSessionId,
            locationData: apiProperty ? {
                hasLocation: !!apiProperty.location,
                locationType: typeof apiProperty.location,
                coordinates: apiProperty.location?.coordinates,
                coordinatesType: typeof apiProperty.location?.coordinates,
                coordinatesLength: apiProperty.location?.coordinates?.length,
                addressCoordinates: apiProperty.address?.coordinates,
                addressCoordinatesType: typeof apiProperty.address?.coordinates,
                showAddressNumber: apiProperty.address?.showAddressNumber,
                showAddressNumberType: typeof apiProperty.address?.showAddressNumber
            } : null
        });
    }, [id, apiProperty, isLoading, error, oxyServices, activeSessionId]);

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

            const price = apiProperty.rent
                ? `${currency}${apiProperty.rent.amount}/${priceUnit}`
                : '';

            // Generate title dynamically from property data
            const generatedTitle = generatePropertyTitle({
                type: Object.values(PropertyType).includes(apiProperty.type) ? apiProperty.type as PropertyType : PropertyType.APARTMENT,
                address: apiProperty.address,
                bedrooms: apiProperty.bedrooms,
                bathrooms: apiProperty.bathrooms
            });

            const isEcoCertified = apiProperty.amenities?.some((a: string) =>
                a.toLowerCase().includes('eco') ||
                a.toLowerCase().includes('green') ||
                a.toLowerCase().includes('solar')
            ) || false;

            return {
                id,
                title: generatedTitle,
                description: apiProperty.description || '',
                location: `${apiProperty.address?.city || ''}, ${apiProperty.address?.country || ''}`,
                price,
                priceUnit,
                bedrooms: apiProperty.bedrooms || 0,
                bathrooms: apiProperty.bathrooms || 0,
                size: apiProperty.squareFootage || 0,
                isVerified: apiProperty.status === 'available',
                isEcoCertified,
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
        if (apiProperty && !hasViewedRef.current) {
            hasViewedRef.current = true;

            const propertyId = apiProperty._id || apiProperty.id;

            if (oxyServices && activeSessionId) {
                console.log('PropertyDetailPage: Tracking property view for authenticated user', {
                    propertyId,
                    hasOxyServices: !!oxyServices,
                    hasActiveSession: !!activeSessionId
                });

                // Add property to Zustand state immediately for instant UI feedback
                if (propertyId) {
                    addItem(propertyId, RecentlyViewedType.PROPERTY, apiProperty);
                }

                // Call the backend to track the view in database
                if (propertyId) {
                    userApi.trackPropertyView(propertyId, oxyServices, activeSessionId)
                        .then(() => {
                            console.log('PropertyDetailPage: Successfully tracked property view in backend');
                        })
                        .catch((error) => {
                            console.error('PropertyDetailPage: Failed to track property view in backend:', error);
                        });
                }
            } else {
                console.log('PropertyDetailPage: User not authenticated, adding to local state only');

                // For unauthenticated users, only add to local Zustand state
                if (propertyId) {
                    addItem(propertyId, RecentlyViewedType.PROPERTY, apiProperty);
                }
            }
        }
    }, [apiProperty, oxyServices, activeSessionId, recentlyViewed, addItem]);

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

            // Full details for clipboard and sharing
            const fullDetails = `🏠 ${property.title}\n\n📍 ${property.location}\n💰 ${property.price}\n🛏️ ${property.bedrooms} Bedrooms\n🚿 ${property.bathrooms} Bathrooms\n📏 ${property.size}m²\n\n${propertyUrl}`;

            try {
                await Share.share({
                    message: fullDetails,
                    url: propertyUrl,
                    title: 'Share Property',
                });
            } catch (shareError) {
                // fallback to clipboard
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
            <View style={{ flex: 1 }}>
                <Header
                    options={{
                        showBackButton: true,
                        title: t("Loading...") || "Loading...",
                        titlePosition: 'center',
                    }}
                />
                <SafeAreaView style={styles.contentArea} edges={['top']}>
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={colors.primaryColor} />
                        <ThemedText style={styles.loadingText}>{t("property.loading") || "Loading property..."}</ThemedText>
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
                        title: t("property.error") || "Error",
                        titlePosition: 'center',
                    }}
                />
                <SafeAreaView style={styles.contentArea} edges={['top']}>
                    <View style={styles.errorContainer}>
                        <ThemedText style={styles.errorText}>{t("property.notFound") || "Property not found"}</ThemedText>
                        <Button
                            onPress={() => router.back()}
                            style={styles.goBackButton}
                        >
                            {t("goBack") || "Go Back"}
                        </Button>
                    </View>
                </SafeAreaView>
            </View>
        );
    }

    const isPropertyFavorite = isFavorite(property.id);

    return (
        <View style={styles.safeArea}>
            {/* Platform-specific header wrapper */}
            <View style={Platform.OS === 'web' ? styles.webHeaderWrapper : styles.nativeHeaderWrapper}>
                <Header
                    options={{
                        showBackButton: true,
                        title: '',
                        titlePosition: 'center',
                        transparent: true,
                        scrollThreshold: 100,
                        rightComponents: [
                            <TouchableOpacity key="share" style={styles.headerButton} onPress={handleShare}>
                                <IconComponent name="share-outline" size={24} color="#222" />
                            </TouchableOpacity>,
                            <SaveButton
                                key="save"
                                isSaved={isPropertyFavorite}
                                onPress={() => toggleFavorite(property.id || '', apiProperty || {})}
                                variant="heart"
                                color="#222"
                                activeColor="#EF4444"
                                isLoading={isPropertySaving(property.id || '')}
                            />,
                        ],
                    }}
                    scrollY={scrollY}
                />
            </View>
            <Animated.ScrollView
                style={styles.scrollView}
                showsVerticalScrollIndicator={false}
                onScroll={Animated.event(
                    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
                    { useNativeDriver: false }
                )}
                scrollEventThrottle={16}
            >
                {/* Main Image - Starts from very top, behind header/safe area */}
                <Image
                    source={getPropertyImageSource(property.images)}
                    style={Platform.OS === 'web' ? styles.mainImageWeb : styles.mainImage}
                    resizeMode="cover"
                />
                {/* Enhanced Header Section */}
                <View style={styles.enhancedHeader}>
                    <ThemedText style={styles.headerTitle} numberOfLines={2}>{property.title}</ThemedText>
                    <View style={styles.headerLocation}>
                        <ThemedText style={styles.headerLocationText}>{property.location}</ThemedText>
                    </View>
                    <View style={styles.headerStats}>
                        <View style={styles.headerStat}>
                            <ThemedText style={styles.headerStatText}>{property.bedrooms} {t(Platform.OS === 'web' ? "property.bed" : "Bed") || (Platform.OS === 'web' ? "Bed" : "Bed")}</ThemedText>
                        </View>
                        <View style={styles.headerStat}>
                            <ThemedText style={styles.headerStatText}>{property.bathrooms} {t(Platform.OS === 'web' ? "property.bath" : "Bath") || (Platform.OS === 'web' ? "Bath" : "Bath")}</ThemedText>
                        </View>
                        <View style={styles.headerStat}>
                            <ThemedText style={styles.headerStatText}>{property.size}m²</ThemedText>
                        </View>
                    </View>
                </View>
                <View style={styles.container}>
                    {/* Property Images Grid */}
                    <View style={styles.imageGridContainer}>
                        <View style={styles.imageGrid}>
                            {/* Left Column */}
                            <View style={styles.mainImageContainer}>
                                <Image
                                    source={getPropertyImageSource(property.images)}
                                    style={styles.mainImageInside}
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
                                    {apiProperty?.location?.coordinates && apiProperty.location.coordinates.length === 2 && (apiProperty?.address?.showAddressNumber ?? true) ? (
                                        <PropertyMap
                                            latitude={apiProperty.location.coordinates[1]}
                                            longitude={apiProperty.location.coordinates[0]}
                                            address={property.location}
                                            height={96}
                                            interactive={false}
                                            showMarker={true}
                                        />
                                    ) : apiProperty?.location?.coordinates && apiProperty.location.coordinates.length === 2 ? (
                                        <PropertyMap
                                            latitude={apiProperty.location.coordinates[1]}
                                            longitude={apiProperty.location.coordinates[0]}
                                            address={property.location}
                                            height={96}
                                            interactive={false}
                                            showMarker={false}
                                        />
                                    ) : (
                                        <View style={[styles.mapPreviewContainer, { justifyContent: 'center', alignItems: 'center' }]}>
                                            <ThemedText style={styles.locationPrivacyText}>
                                                {t("Location hidden") || "Location hidden"}
                                            </ThemedText>
                                        </View>
                                    )}
                                    <View style={styles.mapOverlay}>
                                        <ThemedText style={styles.mapOverlayText}>Location</ThemedText>
                                    </View>
                                </View>
                            </View>
                        </View>
                    </View>

                    {/* Photo Gallery */}
                    {property.images && property.images.length > 0 && (
                        <View style={styles.photoGalleryContainer}>
                            <View style={styles.galleryHeader}>
                                <ThemedText style={styles.sectionTitle}>{t("Photo Gallery")}</ThemedText>
                                <TouchableOpacity style={styles.viewAllButton} onPress={() => setShowPhotoGallery(true)}>
                                    <ThemedText style={styles.viewAllButtonText}>{t("View All")}</ThemedText>
                                    <IconComponent name="chevron-forward" size={16} color={colors.primaryColor} />
                                </TouchableOpacity>
                            </View>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.galleryScroll}>
                                {property.images.slice(0, 5).map((image, index) => (
                                    <TouchableOpacity
                                        key={index}
                                        style={styles.galleryImageContainer}
                                        onPress={() => {
                                            setActiveImageIndex(index);
                                            setShowPhotoGallery(true);
                                        }}
                                    >
                                        <Image
                                            source={getPropertyImageSource([image as any])}
                                            style={styles.galleryImage}
                                            resizeMode="cover"
                                        />
                                        {index === 4 && property.images.length > 5 && (
                                            <View style={styles.moreImagesOverlay}>
                                                <ThemedText style={styles.moreImagesText}>+{property.images.length - 5}</ThemedText>
                                            </View>
                                        )}
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>
                    )}

                    {/* Full-Screen Photo Gallery Modal */}
                    <Modal
                        visible={showPhotoGallery}
                        transparent={true}
                        animationType="fade"
                        onRequestClose={() => setShowPhotoGallery(false)}
                    >
                        <View style={styles.photoModalContainer}>
                            <View style={styles.photoModalHeader}>
                                <TouchableOpacity
                                    style={styles.closeButton}
                                    onPress={() => setShowPhotoGallery(false)}
                                >
                                    <IconComponent name="close" size={24} color="white" />
                                </TouchableOpacity>
                                <ThemedText style={styles.photoModalTitle}>
                                    {activeImageIndex + 1} / {property.images.length}
                                </ThemedText>
                            </View>
                            <ScrollView
                                horizontal
                                pagingEnabled
                                showsHorizontalScrollIndicator={false}
                                onMomentumScrollEnd={(event) => {
                                    const newIndex = Math.round(event.nativeEvent.contentOffset.x / event.nativeEvent.layoutMeasurement.width);
                                    setActiveImageIndex(newIndex);
                                }}
                                style={styles.photoModalScroll}
                            >
                                {property.images.map((image, index) => (
                                    <View key={index} style={styles.photoModalImageContainer}>
                                        <Image
                                            source={getPropertyImageSource([image as any])}
                                            style={styles.photoModalImage}
                                            resizeMode="contain"
                                        />
                                    </View>
                                ))}
                            </ScrollView>
                            <View style={styles.photoModalFooter}>
                                <TouchableOpacity
                                    style={styles.photoModalButton}
                                    onPress={() => {
                                        const newIndex = activeImageIndex > 0 ? activeImageIndex - 1 : property.images.length - 1;
                                        setActiveImageIndex(newIndex);
                                    }}
                                >
                                    <IconComponent name="chevron-back" size={24} color="white" />
                                </TouchableOpacity>
                                <View style={styles.photoModalDots}>
                                    {property.images.map((_, index) => (
                                        <View
                                            key={index}
                                            style={[
                                                styles.photoModalDot,
                                                index === activeImageIndex && styles.photoModalDotActive
                                            ]}
                                        />
                                    ))}
                                </View>
                                <TouchableOpacity
                                    style={styles.photoModalButton}
                                    onPress={() => {
                                        const newIndex = activeImageIndex < property.images.length - 1 ? activeImageIndex + 1 : 0;
                                        setActiveImageIndex(newIndex);
                                    }}
                                >
                                    <IconComponent name="chevron-forward" size={24} color="white" />
                                </TouchableOpacity>
                            </View>
                        </View>
                    </Modal>

                    {/* Basic Info */}
                    <View style={styles.infoContainer}>
                        <View style={styles.priceContainer}>
                            <ThemedText style={styles.priceLabel}>
                                {property.priceUnit === 'day' ? (t("Daily Rent") || "Daily Rent") :
                                    property.priceUnit === 'night' ? (t("Nightly Rent") || "Nightly Rent") :
                                        property.priceUnit === 'week' ? (t("Weekly Rent") || "Weekly Rent") :
                                            property.priceUnit === 'month' ? (t("Monthly Rent") || "Monthly Rent") :
                                                property.priceUnit === 'year' ? (t("Yearly Rent") || "Yearly Rent") :
                                                    (t("Rent") || "Rent")}
                            </ThemedText>
                            <CurrencyFormatter
                                amount={parseFloat(property.price) || 0}
                                originalCurrency={apiProperty?.rent?.currency || 'USD'}
                                showConversion={true}
                            />
                        </View>

                        {/* Eco Rating */}
                        {property.isEcoCertified && (
                            <>
                                <View style={styles.ecoRatingContainer}>
                                    <View style={styles.ratingHeader}>
                                        <ThemedText style={styles.ratingTitle}>{t("Energy Efficiency") || "Energy Efficiency"}</ThemedText>
                                    </View>
                                    <View style={styles.energyRatingContainer}>
                                        <View style={[styles.energyRatingBadge, { backgroundColor: '#2e7d32' }]}>
                                            <ThemedText style={styles.energyRatingText}>{property.energyRating}</ThemedText>
                                        </View>
                                        <ThemedText style={styles.energyRatingDesc}>
                                            {t("This property meets high standards for energy efficiency") || "This property meets high standards for energy efficiency"}
                                        </ThemedText>
                                    </View>
                                </View>
                            </>
                        )}

                        {/* Description */}
                        {property.description && property.description.trim() !== '' && (
                            <>
                                <View style={styles.descriptionContainer}>
                                    <ThemedText style={styles.sectionTitle}>{t("About this property") || "About this property"}</ThemedText>
                                    <View style={styles.descriptionCard}>
                                        <ThemedText style={styles.descriptionText}>{property.description}</ThemedText>
                                    </View>
                                </View>
                            </>
                        )}

                        {/* Detailed Property Information */}
                        <View style={styles.detailedInfoContainer}>
                            <ThemedText style={styles.sectionTitle}>{t("Property Details") || "Property Details"}</ThemedText>
                            <View style={styles.detailedInfoCard}>
                                <View style={styles.detailedInfoRow}>
                                    <View style={styles.detailedInfoItem}>
                                        <ThemedText style={styles.detailedInfoLabel}>{t("Property Type") || "Property Type"}</ThemedText>
                                        <ThemedText style={styles.detailedInfoValue}>
                                            {apiProperty?.type ? apiProperty.type.charAt(0).toUpperCase() + apiProperty.type.slice(1) : t("Not specified") || "Not specified"}
                                        </ThemedText>
                                    </View>
                                    {apiProperty?.floor !== undefined && (
                                        <View style={styles.detailedInfoItem}>
                                            <ThemedText style={styles.detailedInfoLabel}>{t("Floor") || "Floor"}</ThemedText>
                                            <ThemedText style={styles.detailedInfoValue}>{apiProperty.floor}</ThemedText>
                                        </View>
                                    )}
                                </View>
                                <View style={styles.detailedInfoRow}>
                                    {apiProperty?.yearBuilt && (
                                        <View style={styles.detailedInfoItem}>
                                            <ThemedText style={styles.detailedInfoLabel}>{t("Year Built") || "Year Built"}</ThemedText>
                                            <ThemedText style={styles.detailedInfoValue}>{apiProperty.yearBuilt}</ThemedText>
                                        </View>
                                    )}
                                    {apiProperty?.parkingSpaces !== undefined && (
                                        <View style={styles.detailedInfoItem}>
                                            <ThemedText style={styles.detailedInfoLabel}>{t("Parking Spaces") || "Parking Spaces"}</ThemedText>
                                            <ThemedText style={styles.detailedInfoValue}>{apiProperty.parkingSpaces}</ThemedText>
                                        </View>
                                    )}
                                </View>
                            </View>
                        </View>

                        {/* Property Features */}
                        {(apiProperty?.isFurnished !== undefined || apiProperty?.hasBalcony !== undefined || apiProperty?.hasGarden !== undefined || apiProperty?.hasElevator !== undefined) && (
                            <View style={styles.featuresContainer}>
                                <ThemedText style={styles.sectionTitle}>{t("Property Features")}</ThemedText>
                                <View style={styles.featuresCard}>
                                    <View style={styles.featuresGrid}>
                                        {apiProperty?.isFurnished !== undefined && (
                                            <View style={styles.featureItem}>
                                                <IconComponent
                                                    name={apiProperty.isFurnished ? "checkmark-circle" : "close-circle"}
                                                    size={20}
                                                    color={apiProperty.isFurnished ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                                                />
                                                <ThemedText style={styles.featureText}>{t("Furnished")}</ThemedText>
                                            </View>
                                        )}
                                        {apiProperty?.hasBalcony !== undefined && (
                                            <View style={styles.featureItem}>
                                                <IconComponent
                                                    name={apiProperty.hasBalcony ? "checkmark-circle" : "close-circle"}
                                                    size={20}
                                                    color={apiProperty.hasBalcony ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                                                />
                                                <ThemedText style={styles.featureText}>{t("Balcony")}</ThemedText>
                                            </View>
                                        )}
                                        {apiProperty?.hasGarden !== undefined && (
                                            <View style={styles.featureItem}>
                                                <IconComponent
                                                    name={apiProperty.hasGarden ? "checkmark-circle" : "close-circle"}
                                                    size={20}
                                                    color={apiProperty.hasGarden ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                                                />
                                                <ThemedText style={styles.featureText}>{t("Garden")}</ThemedText>
                                            </View>
                                        )}
                                        {apiProperty?.hasElevator !== undefined && (
                                            <View style={styles.featureItem}>
                                                <IconComponent
                                                    name={apiProperty.hasElevator ? "checkmark-circle" : "close-circle"}
                                                    size={20}
                                                    color={apiProperty.hasElevator ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                                                />
                                                <ThemedText style={styles.featureText}>{t("Elevator")}</ThemedText>
                                            </View>
                                        )}
                                    </View>
                                </View>
                            </View>
                        )}

                        {/* Pricing Details */}
                        <View style={styles.pricingDetailsContainer}>
                            <ThemedText style={styles.sectionTitle}>{t("Pricing Details")}</ThemedText>
                            <View style={styles.pricingDetailsCard}>
                                <View style={styles.pricingDetailRow}>
                                    <ThemedText style={styles.pricingDetailLabel}>{t("Monthly Rent")}</ThemedText>
                                    <CurrencyFormatter
                                        amount={apiProperty?.rent?.amount || 0}
                                        originalCurrency={apiProperty?.rent?.currency || 'USD'}
                                        showConversion={true}
                                    />
                                </View>
                                {apiProperty?.rent?.deposit && apiProperty.rent.deposit > 0 && (
                                    <View style={styles.pricingDetailRow}>
                                        <ThemedText style={styles.pricingDetailLabel}>{t("Security Deposit")}</ThemedText>
                                        <CurrencyFormatter
                                            amount={apiProperty.rent.deposit}
                                            originalCurrency={apiProperty.rent.currency || 'USD'}
                                            showConversion={true}
                                        />
                                    </View>
                                )}
                                {apiProperty?.rent?.utilities && (
                                    <View style={styles.pricingDetailRow}>
                                        <ThemedText style={styles.pricingDetailLabel}>{t("Utilities")}</ThemedText>
                                        <ThemedText style={styles.pricingDetailValue}>
                                            {apiProperty.rent.utilities === 'included' ? t("Included") :
                                                apiProperty.rent.utilities === 'partial' ? t("Partially included") :
                                                    t("Not included")}
                                        </ThemedText>
                                    </View>
                                )}

                            </View>
                        </View>

                        {/* Rules & Policies */}
                        {(apiProperty?.rules?.petsAllowed !== undefined || apiProperty?.rules?.smokingAllowed !== undefined ||
                            apiProperty?.rules?.partiesAllowed !== undefined || apiProperty?.rules?.guestsAllowed !== undefined) && (
                                <View style={styles.rulesContainer}>
                                    <ThemedText style={styles.sectionTitle}>{t("House Rules")}</ThemedText>
                                    <View style={styles.rulesCard}>
                                        <View style={styles.rulesGrid}>
                                            {apiProperty?.rules?.petsAllowed !== undefined && (
                                                <View style={styles.ruleItem}>
                                                    <IconComponent
                                                        name={apiProperty.rules.petsAllowed ? "checkmark-circle" : "close-circle"}
                                                        size={20}
                                                        color={apiProperty.rules.petsAllowed ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                                                    />
                                                    <ThemedText style={styles.ruleText}>{t("Pets Allowed")}</ThemedText>
                                                </View>
                                            )}
                                            {apiProperty?.rules?.smokingAllowed !== undefined && (
                                                <View style={styles.ruleItem}>
                                                    <IconComponent
                                                        name={apiProperty.rules.smokingAllowed ? "checkmark-circle" : "close-circle"}
                                                        size={20}
                                                        color={apiProperty.rules.smokingAllowed ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                                                    />
                                                    <ThemedText style={styles.ruleText}>{t("Smoking Allowed")}</ThemedText>
                                                </View>
                                            )}
                                            {apiProperty?.rules?.partiesAllowed !== undefined && (
                                                <View style={styles.ruleItem}>
                                                    <IconComponent
                                                        name={apiProperty.rules.partiesAllowed ? "checkmark-circle" : "close-circle"}
                                                        size={20}
                                                        color={apiProperty.rules.partiesAllowed ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                                                    />
                                                    <ThemedText style={styles.ruleText}>{t("Parties Allowed")}</ThemedText>
                                                </View>
                                            )}
                                            {apiProperty?.rules?.guestsAllowed !== undefined && (
                                                <View style={styles.ruleItem}>
                                                    <IconComponent
                                                        name={apiProperty.rules.guestsAllowed ? "checkmark-circle" : "close-circle"}
                                                        size={20}
                                                        color={apiProperty.rules.guestsAllowed ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                                                    />
                                                    <ThemedText style={styles.ruleText}>{t("Guests Allowed")}</ThemedText>
                                                </View>
                                            )}
                                        </View>
                                        {apiProperty?.rules?.guestsAllowed && apiProperty?.rules?.maxGuests && (
                                            <View style={styles.maxGuestsContainer}>
                                                <ThemedText style={styles.maxGuestsLabel}>{t("Maximum Guests")}: {apiProperty.rules.maxGuests}</ThemedText>
                                            </View>
                                        )}
                                    </View>
                                </View>
                            )}

                        {/* Location Details */}
                        <View style={styles.locationDetailsContainer}>
                            <ThemedText style={styles.sectionTitle}>{t("Location Details")}</ThemedText>
                            <View style={styles.locationDetailsCard}>
                                {apiProperty?.address?.street && (
                                    <View style={styles.locationDetailRow}>
                                        <ThemedText style={styles.locationDetailLabel}>{t("Address")}</ThemedText>
                                        <ThemedText style={styles.locationDetailValue}>
                                            {apiProperty.address.street}
                                        </ThemedText>
                                    </View>
                                )}
                                {apiProperty?.address?.city && (
                                    <View style={styles.locationDetailRow}>
                                        <ThemedText style={styles.locationDetailLabel}>{t("City")}</ThemedText>
                                        <ThemedText style={styles.locationDetailValue}>{apiProperty.address.city}</ThemedText>
                                    </View>
                                )}
                                {apiProperty?.address?.state && (
                                    <View style={styles.locationDetailRow}>
                                        <ThemedText style={styles.locationDetailLabel}>{t("State/Province")}</ThemedText>
                                        <ThemedText style={styles.locationDetailValue}>{apiProperty.address.state}</ThemedText>
                                    </View>
                                )}
                                {apiProperty?.address?.zipCode && (
                                    <View style={styles.locationDetailRow}>
                                        <ThemedText style={styles.locationDetailLabel}>{t("ZIP/Postal Code")}</ThemedText>
                                        <ThemedText style={styles.locationDetailValue}>{apiProperty.address.zipCode}</ThemedText>
                                    </View>
                                )}
                                {apiProperty?.address?.country && (
                                    <View style={styles.locationDetailRow}>
                                        <ThemedText style={styles.locationDetailLabel}>{t("Country")}</ThemedText>
                                        <ThemedText style={styles.locationDetailValue}>{apiProperty.address.country}</ThemedText>
                                    </View>
                                )}
                            </View>
                        </View>

                        {/* Proximity Features */}
                        {(apiProperty?.proximityToTransport !== undefined || apiProperty?.proximityToSchools !== undefined || apiProperty?.proximityToShopping !== undefined) && (
                            <View style={styles.proximityContainer}>
                                <ThemedText style={styles.sectionTitle}>{t("Nearby Amenities")}</ThemedText>
                                <View style={styles.proximityCard}>
                                    <View style={styles.proximityGrid}>
                                        {apiProperty?.proximityToTransport !== undefined && (
                                            <View style={styles.proximityItem}>
                                                <IconComponent
                                                    name={apiProperty.proximityToTransport ? "checkmark-circle" : "close-circle"}
                                                    size={20}
                                                    color={apiProperty.proximityToTransport ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                                                />
                                                <ThemedText style={styles.proximityText}>{t("Public Transport")}</ThemedText>
                                            </View>
                                        )}
                                        {apiProperty?.proximityToSchools !== undefined && (
                                            <View style={styles.proximityItem}>
                                                <IconComponent
                                                    name={apiProperty.proximityToSchools ? "checkmark-circle" : "close-circle"}
                                                    size={20}
                                                    color={apiProperty.proximityToSchools ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                                                />
                                                <ThemedText style={styles.proximityText}>{t("Schools")}</ThemedText>
                                            </View>
                                        )}
                                        {apiProperty?.proximityToShopping !== undefined && (
                                            <View style={styles.proximityItem}>
                                                <IconComponent
                                                    name={apiProperty.proximityToShopping ? "checkmark-circle" : "close-circle"}
                                                    size={20}
                                                    color={apiProperty.proximityToShopping ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                                                />
                                                <ThemedText style={styles.proximityText}>{t("Shopping")}</ThemedText>
                                            </View>
                                        )}
                                    </View>
                                </View>
                            </View>
                        )}

                        {/* Property Statistics */}
                        <View style={styles.statisticsContainer}>
                            <ThemedText style={styles.sectionTitle}>{t("Property Statistics")}</ThemedText>
                            <View style={styles.statisticsCard}>
                                <View style={styles.statisticsGrid}>
                                    <View style={styles.statisticItem}>
                                        <ThemedText style={styles.statisticValue}>{property.bedrooms}</ThemedText>
                                        <ThemedText style={styles.statisticLabel}>{t("Bedrooms")}</ThemedText>
                                    </View>
                                    <View style={styles.statisticItem}>
                                        <ThemedText style={styles.statisticValue}>{property.bathrooms}</ThemedText>
                                        <ThemedText style={styles.statisticLabel}>{t("Bathrooms")}</ThemedText>
                                    </View>
                                    <View style={styles.statisticItem}>
                                        <ThemedText style={styles.statisticValue}>{property.size}m²</ThemedText>
                                        <ThemedText style={styles.statisticLabel}>{t("Size")}</ThemedText>
                                    </View>
                                    {apiProperty?.floor !== undefined && (
                                        <View style={styles.statisticItem}>
                                            <ThemedText style={styles.statisticValue}>{apiProperty.floor}</ThemedText>
                                            <ThemedText style={styles.statisticLabel}>{t("Floor")}</ThemedText>
                                        </View>
                                    )}
                                </View>
                            </View>
                        </View>

                        {/* Energy Efficiency & Sustainability */}
                        {property.isEcoCertified && (
                            <View style={styles.energyContainer}>
                                <ThemedText style={styles.sectionTitle}>{t("Energy Efficiency & Sustainability")}</ThemedText>
                                <View style={styles.energyCard}>
                                    <View style={styles.energyHeader}>
                                        <IconComponent name="leaf" size={24} color="#2e7d32" />
                                        <ThemedText style={styles.energyTitle}>{t("Eco-Certified Property")}</ThemedText>
                                    </View>
                                    <View style={styles.energyRatingContainer}>
                                        <View style={[styles.energyRatingBadge, { backgroundColor: '#2e7d32' }]}>
                                            <ThemedText style={styles.energyRatingText}>{property.energyRating}</ThemedText>
                                        </View>
                                        <ThemedText style={styles.energyDescription}>
                                            {t("This property meets high standards for energy efficiency and sustainability")}
                                        </ThemedText>
                                    </View>
                                    <View style={styles.energyFeatures}>
                                        <View style={styles.energyFeature}>
                                            <IconComponent name="checkmark-circle" size={16} color="#2e7d32" />
                                            <ThemedText style={styles.energyFeatureText}>{t("Energy-efficient appliances")}</ThemedText>
                                        </View>
                                        <View style={styles.energyFeature}>
                                            <IconComponent name="checkmark-circle" size={16} color="#2e7d32" />
                                            <ThemedText style={styles.energyFeatureText}>{t("Sustainable building materials")}</ThemedText>
                                        </View>
                                        <View style={styles.energyFeature}>
                                            <IconComponent name="checkmark-circle" size={16} color="#2e7d32" />
                                            <ThemedText style={styles.energyFeatureText}>{t("Reduced carbon footprint")}</ThemedText>
                                        </View>
                                    </View>
                                </View>
                            </View>
                        )}

                        {/* Neighborhood Information */}
                        <View style={styles.neighborhoodContainer}>
                            <ThemedText style={styles.sectionTitle}>{t("Neighborhood")}</ThemedText>
                            <View style={styles.neighborhoodCard}>
                                <View style={styles.neighborhoodHeader}>
                                    <IconComponent name="location" size={20} color={colors.primaryColor} />
                                    <ThemedText style={styles.neighborhoodTitle}>{apiProperty?.address?.city || t("Location")}</ThemedText>
                                </View>
                                <View style={styles.neighborhoodStats}>
                                    <View style={styles.neighborhoodStat}>
                                        <ThemedText style={styles.neighborhoodStatValue}>4.2</ThemedText>
                                        <ThemedText style={styles.neighborhoodStatLabel}>{t("Safety Rating")}</ThemedText>
                                    </View>
                                    <View style={styles.neighborhoodStat}>
                                        <ThemedText style={styles.neighborhoodStatValue}>85</ThemedText>
                                        <ThemedText style={styles.neighborhoodStatLabel}>{t("Walk Score")}</ThemedText>
                                    </View>
                                    <View style={styles.neighborhoodStat}>
                                        <ThemedText style={styles.neighborhoodStatValue}>92</ThemedText>
                                        <ThemedText style={styles.neighborhoodStatLabel}>{t("Transit Score")}</ThemedText>
                                    </View>
                                </View>
                                <ThemedText style={styles.neighborhoodDescription}>
                                    {t("This neighborhood offers excellent connectivity with public transportation, shopping centers, and educational institutions within walking distance.")}
                                </ThemedText>
                            </View>
                        </View>

                        {/* Contact & Communication */}
                        <View style={styles.contactContainer}>
                            <ThemedText style={styles.sectionTitle}>{t("Contact Information")}</ThemedText>
                            <View style={styles.contactCard}>
                                <View style={styles.contactMethods}>
                                    <TouchableOpacity style={styles.contactMethod} onPress={handleContact}>
                                        <IconComponent name="mail-outline" size={24} color={colors.primaryColor} />
                                        <ThemedText style={styles.contactMethodText}>{t("Send Message")}</ThemedText>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={styles.contactMethod} onPress={handleContact}>
                                        <IconComponent name="call-outline" size={24} color={colors.primaryColor} />
                                        <ThemedText style={styles.contactMethodText}>{t("Call Now")}</ThemedText>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={styles.contactMethod} onPress={handleScheduleViewing}>
                                        <IconComponent name="calendar-outline" size={24} color={colors.primaryColor} />
                                        <ThemedText style={styles.contactMethodText}>{t("Schedule Viewing")}</ThemedText>
                                    </TouchableOpacity>
                                </View>
                                <View style={styles.responseTime}>
                                    <IconComponent name="time-outline" size={16} color={colors.COLOR_BLACK_LIGHT_3} />
                                    <ThemedText style={styles.responseTimeText}>{t("Average response time: 2 hours")}</ThemedText>
                                </View>
                            </View>
                        </View>

                        {/* Availability */}
                        <View style={styles.availabilityContainer}>
                            <View style={styles.availabilityItem}>
                                <ThemedText style={styles.availabilityLabel}>{t("Available From")}</ThemedText>
                                <ThemedText style={styles.availabilityValue}>{new Date(property.availableFrom).toLocaleDateString()}</ThemedText>
                            </View>
                            <View style={styles.availabilityItem}>
                                <ThemedText style={styles.availabilityLabel}>{t("Minimum Stay")}</ThemedText>
                                <ThemedText style={styles.availabilityValue}>{property.minStay}</ThemedText>
                            </View>
                        </View>

                        {/* Amenities */}
                        <ThemedText style={styles.sectionTitle}>{t("What's Included")}</ThemedText>

                        <AmenitiesDisplay amenities={property.amenities} title="" />

                        {/* Map - Only show if location coordinates are available */}
                        {apiProperty?.location?.coordinates && apiProperty.location.coordinates.length === 2 && (
                            <>
                                <ThemedText style={styles.sectionTitle}>{t("Location")}</ThemedText>
                                <PropertyMap
                                    latitude={apiProperty.location.coordinates[1]}
                                    longitude={apiProperty.location.coordinates[0]}
                                    address={property.location}
                                    height={200}
                                    interactive={false}
                                    showMarker={apiProperty?.address?.showAddressNumber ?? true}
                                />
                            </>
                        )}

                        {/* Landlord Info / Government Housing Authority */}
                        <ThemedText style={styles.sectionTitle}>
                            {apiProperty?.housingType === 'public' ? t("Housing Authority") : t("Landlord")}
                        </ThemedText>
                        <View style={styles.landlordCard}>
                            {apiProperty?.housingType === 'public' ? (
                                <>
                                    <View style={styles.landlordHeader}>
                                        <View style={[styles.landlordAvatar, styles.governmentAvatar]}>
                                            <IconComponent name="library" size={28} color="white" />
                                        </View>
                                        <View style={styles.landlordInfo}>
                                            <View style={styles.landlordNameRow}>
                                                <ThemedText style={styles.landlordName}>
                                                    {apiProperty?.address?.state ? `${apiProperty.address.state} Housing Authority` : 'Public Housing Authority'}
                                                </ThemedText>
                                                <View style={[styles.verifiedBadge, styles.governmentBadge]}>
                                                    <ThemedText style={styles.verifiedText}>GOV</ThemedText>
                                                </View>
                                            </View>
                                            <ThemedText style={styles.landlordRating}>
                                                Government-managed affordable housing
                                            </ThemedText>
                                        </View>
                                    </View>
                                    <View style={styles.landlordActions}>
                                        <ActionButton
                                            icon="globe"
                                            text={t("Apply on State Website")}
                                            onPress={handlePublicHousingApply}
                                            variant="primary"
                                            size="medium"
                                            style={{ flex: 1 }}
                                        />
                                    </View>
                                </>
                            ) : (
                                <>
                                    <View style={styles.landlordHeader}>
                                        <View style={styles.landlordAvatar}>
                                            <ThemedText style={styles.landlordInitial}>
                                                {getLandlordDisplayName(landlordProfile)}
                                            </ThemedText>
                                        </View>
                                        <View style={styles.landlordInfo}>
                                            <View style={styles.landlordNameRow}>
                                                <ThemedText style={styles.landlordName}>
                                                    {getLandlordDisplayName(landlordProfile)}
                                                </ThemedText>
                                                {landlordProfile?.isActive && (
                                                    <View style={styles.verifiedBadge}>
                                                        <ThemedText style={styles.verifiedText}>✓</ThemedText>
                                                    </View>
                                                )}
                                            </View>
                                            <ThemedText style={styles.landlordRating}>
                                                {getLandlordTrustScore(landlordProfile)}
                                            </ThemedText>
                                        </View>
                                    </View>
                                    <View style={styles.landlordActions}>
                                        <ActionButton
                                            icon="chatbubble-outline"
                                            text={t("Message")}
                                            onPress={handleContact}
                                            variant="primary"
                                            size="medium"
                                            disabled={!landlordProfile}
                                            style={{ flex: 1, marginRight: 8 }}
                                        />
                                        <ActionButton
                                            icon="call-outline"
                                            text={t("Call")}
                                            onPress={handleContact}
                                            variant="secondary"
                                            size="medium"
                                            disabled={!landlordProfile}
                                            style={{ flex: 1, marginLeft: 8 }}
                                        />
                                    </View>
                                </>
                            )}
                        </View>

                        {/* Sindi Analysis */}
                        <View style={styles.sindiContainer}>
                            <LinearGradient
                                colors={[colors.primaryColor, colors.secondaryLight]}
                                style={styles.sindiGradient}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                            >
                                <View style={styles.sindiHeader}>
                                    <View style={styles.sindiIconContainer}>
                                        <View style={styles.sindiIconBackground}>
                                            <SindiIcon size={32} color="white" />
                                        </View>
                                        <View style={styles.sindiIconGlow} />
                                    </View>
                                    <View style={styles.sindiTextContainer}>
                                        <ThemedText style={styles.sindiTitle}>Sindi personally analyzed this property</ThemedText>
                                        <ThemedText style={styles.sindiDescription}>
                                            I&apos;ve verified this property for authenticity and condition. Ask me anything about it!
                                        </ThemedText>
                                    </View>
                                    <TouchableOpacity style={styles.askSindiButton} onPress={() => { }}>
                                        <IconComponent name="chatbubble-outline" size={14} color="white" />
                                    </TouchableOpacity>
                                </View>
                            </LinearGradient>
                        </View>

                        {/* Action Buttons */}
                        <View style={styles.actionButtonsContainer}>
                            {apiProperty?.housingType === 'public' ? (
                                <>
                                    <ActionButton
                                        icon="chatbubble-outline"
                                        text={t("Contact Housing Authority")}
                                        onPress={() => { }}
                                        variant="secondary"
                                        size="large"
                                        disabled={true}
                                        style={{ flex: 1, marginRight: 10 }}
                                    />
                                    <ActionButton
                                        icon="globe"
                                        text={t("Apply on State Website")}
                                        onPress={handleApply}
                                        variant="primary"
                                        size="large"
                                        style={{ flex: 1 }}
                                    />
                                </>
                            ) : (
                                <>
                                    <ActionButton
                                        icon="calendar-outline"
                                        text={t("Schedule Viewing")}
                                        onPress={handleScheduleViewing}
                                        variant="outline"
                                        size="large"
                                        style={{ flex: 1, marginRight: 10 }}
                                    />
                                    <ActionButton
                                        icon="checkmark-circle-outline"
                                        text={t("Apply Now")}
                                        onPress={handleApply}
                                        variant="primary"
                                        size="large"
                                        style={{ flex: 1 }}
                                    />
                                </>
                            )}
                        </View>

                        {/* Fraud Warning */}
                        <View style={styles.fraudWarningContainer}>
                            <ThemedText style={styles.fraudWarningText}>
                                {t("Never pay or transfer funds outside the Homio platform")}
                            </ThemedText>
                        </View>
                    </View>
                </View>
            </Animated.ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        position: 'relative',
    },
    scrollView: {
        flex: 1,
        ...Platform.select({
            web: {
                marginTop: -80, // Compensate for header height on web
            },
        }),
    },
    contentArea: {
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
        borderRadius: 25,
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
        height: 300,
        marginTop: -50, // Start behind the safe area
    } as any,
    mainImageWeb: {
        width: '100%',
        height: 300,
        marginTop: -80, // Start behind the header on web - increased for better overlap
    } as any,
    headerOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
    },
    mainImageInside: {
        width: '100%',
        height: '100%',
        borderRadius: 12,
    } as any,
    sideImage: {
        width: '100%',
        height: '100%',
        borderRadius: 12,
    } as any,
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
        borderRadius: 16,
        padding: 20,
        marginBottom: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
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

    trustContainer: {
        flexDirection: 'row',
        padding: 15,
        borderRadius: 10,
        marginBottom: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
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
    detailedInfoContainer: {
        marginBottom: 20,
    },
    detailedInfoCard: {
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
    detailedInfoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    detailedInfoItem: {
        flex: 1,
    },
    detailedInfoLabel: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginBottom: 5,
    },
    detailedInfoValue: {
        fontSize: 16,
        fontWeight: 'bold',
        color: colors.COLOR_BLACK,
    },
    featuresContainer: {
        marginBottom: 20,
    },
    featuresCard: {
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
    featuresGrid: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        flexWrap: 'wrap',
    },
    featureItem: {
        alignItems: 'center',
        marginVertical: 10,
    },
    featureText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginTop: 5,
    },
    pricingDetailsContainer: {
        marginBottom: 20,
    },
    pricingDetailsCard: {
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
    pricingDetailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    pricingDetailLabel: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    pricingDetailValue: {
        fontSize: 16,
        fontWeight: 'bold',
        color: colors.COLOR_BLACK,
    },
    rulesContainer: {
        marginBottom: 20,
    },
    rulesCard: {
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
    rulesGrid: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        flexWrap: 'wrap',
    },
    ruleItem: {
        alignItems: 'center',
        marginVertical: 10,
    },
    ruleText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginTop: 5,
    },
    maxGuestsContainer: {
        marginTop: 10,
        alignItems: 'center',
    },
    maxGuestsLabel: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    locationDetailsContainer: {
        marginBottom: 20,
    },
    locationDetailsCard: {
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
    locationDetailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    locationDetailLabel: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    locationDetailValue: {
        fontSize: 16,
        fontWeight: 'bold',
        color: colors.COLOR_BLACK,
    },
    proximityContainer: {
        marginBottom: 20,
    },
    proximityCard: {
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
    proximityGrid: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        flexWrap: 'wrap',
    },
    proximityItem: {
        alignItems: 'center',
        marginVertical: 10,
    },
    proximityText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginTop: 5,
    },
    statisticsContainer: {
        marginBottom: 20,
    },
    statisticsCard: {
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
    statisticsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        flexWrap: 'wrap',
    },
    statisticItem: {
        alignItems: 'center',
        marginVertical: 10,
    },
    statisticValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: colors.primaryColor,
    },
    statisticLabel: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginTop: 5,
    },
    energyContainer: {
        marginBottom: 20,
    },
    energyCard: {
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
    energyHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    energyTitle: {
        marginLeft: 8,
        fontSize: 16,
        fontWeight: 'bold',
    },

    energyDescription: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginBottom: 10,
    },
    energyFeatures: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        flexWrap: 'wrap',
    },
    energyFeature: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 5,
    },
    energyFeatureText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginLeft: 5,
    },
    neighborhoodContainer: {
        marginBottom: 20,
    },
    neighborhoodCard: {
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
    neighborhoodHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    neighborhoodTitle: {
        marginLeft: 8,
        fontSize: 16,
        fontWeight: 'bold',
    },
    neighborhoodStats: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginBottom: 10,
    },
    neighborhoodStat: {
        alignItems: 'center',
    },
    neighborhoodStatValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: colors.primaryColor,
    },
    neighborhoodStatLabel: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginTop: 5,
    },
    neighborhoodDescription: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        textAlign: 'justify',
    },
    contactContainer: {
        marginBottom: 20,
    },
    contactCard: {
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
    contactMethods: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginBottom: 10,
    },
    contactMethod: {
        alignItems: 'center',
    },
    contactMethodText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginTop: 5,
    },
    responseTime: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    responseTimeText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginLeft: 5,
    },
    photoGalleryContainer: {
        marginBottom: 20,
        padding: 10,
    },
    galleryHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    viewAllButton: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    viewAllButtonText: {
        fontSize: 14,
        color: colors.primaryColor,
        marginRight: 5,
    },
    galleryScroll: {
        height: 100, // Fixed height for the horizontal scroll
    },
    galleryImageContainer: {
        width: 100,
        height: 100,
        borderRadius: 8,
        marginRight: 10,
        overflow: 'hidden',
    },
    galleryImage: {
        width: '100%',
        height: '100%',
    } as any,
    moreImagesOverlay: {
        position: 'absolute',
        top: 0,
        right: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderRadius: 8,
        paddingHorizontal: 4,
        paddingVertical: 2,
    },
    moreImagesText: {
        color: 'white',
        fontSize: 12,
        fontWeight: 'bold',
    },
    photoModalContainer: {
        flex: 1,
        backgroundColor: 'black',
        justifyContent: 'center',
        alignItems: 'center',
    },
    photoModalHeader: {
        position: 'absolute',
        top: 50,
        left: 20,
        flexDirection: 'row',
        alignItems: 'center',
        zIndex: 1,
    },
    closeButton: {
        padding: 10,
    },
    photoModalTitle: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
        marginLeft: 10,
    },
    photoModalScroll: {
        width: '100%',
        height: '80%',
    },
    photoModalImageContainer: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    photoModalImage: {
        width: '100%',
        height: '100%',
    } as any,
    photoModalFooter: {
        position: 'absolute',
        bottom: 20,
        flexDirection: 'row',
        justifyContent: 'space-around',
        width: '100%',
        zIndex: 1,
    },
    photoModalButton: {
        padding: 10,
    },
    photoModalDots: {
        flexDirection: 'row',
        alignSelf: 'center',
        marginHorizontal: 10,
    },
    photoModalDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: 'rgba(255,255,255,0.5)',
        marginHorizontal: 4,
    },
    photoModalDotActive: {
        backgroundColor: 'white',
    },
    sindiContainer: {
        marginBottom: 20,
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    sindiGradient: {
        padding: 20,
    },
    sindiHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    sindiIconContainer: {
        marginRight: 16,
    },
    sindiIconBackground: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
    },
    sindiIconGlow: {
        position: 'absolute',
        top: -3,
        left: -3,
        right: -3,
        bottom: -3,
        borderRadius: 23,
        backgroundColor: 'rgba(255, 255, 255, 0.3)',
        zIndex: -1,
    },
    sindiTextContainer: {
        flex: 1,
    },
    sindiTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: 'white',
        marginBottom: 4,
    },
    sindiDescription: {
        fontSize: 14,
        color: 'rgba(255, 255, 255, 0.9)',
        lineHeight: 20,
    },
    askSindiButton: {
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.3)',
        marginLeft: 12,
    },
    locationPrivacyContainer: {
        backgroundColor: colors.COLOR_BLACK_LIGHT_1,
        borderRadius: 12,
        padding: 20,
        alignItems: 'center',
        marginVertical: 10,
    },
    locationPrivacyText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
        marginBottom: 8,
        textAlign: 'center',
    },
    locationPrivacySubtext: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        textAlign: 'center',
        lineHeight: 20,
    },
    webHeaderWrapper: {
        position: 'sticky' as any,
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
    },
    nativeHeaderWrapper: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
    },
}); 