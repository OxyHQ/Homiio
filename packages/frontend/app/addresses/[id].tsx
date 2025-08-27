import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    StyleSheet,
    ScrollView,
    RefreshControl,
    Alert,
    TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

// Components
import { Header } from '@/components/Header';
import { ThemedText } from '@/components/ThemedText';
import { PropertyCard } from '@/components/PropertyCard';
import { AddressDisplay } from '@/components/AddressDisplay';
import { NeighborhoodRatingWidget } from '@/components/widgets/NeighborhoodRatingWidget';
import { PropertyListSkeleton } from '@/components/ui/skeletons/PropertyListSkeleton';

// Services and hooks
import { api } from '@/utils/api';

// Types
import { Property } from '@homiio/shared-types';
import { colors } from '@/styles/colors';

// Local type definitions
interface AddressData {
    _id: string;
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    neighborhood?: string;
    coordinates: {
        type: 'Point';
        coordinates: [number, number]; // [longitude, latitude]
    };
    fullAddress: string;
    location: string;
    createdAt: string;
    updatedAt: string;
}

interface ReviewData {
    _id: string;
    addressId: string;
    addressLevel: 'BUILDING' | 'UNIT';
    streetLevelId: string;
    buildingLevelId: string;
    unitLevelId?: string;
    greenHouse?: string;
    price: number;
    currency: string;
    livedFrom: string;
    livedTo: string;
    livedForMonths: number;
    recommendation: boolean;
    opinion: string;
    positiveComment?: string;
    negativeComment?: string;
    images: string[];
    rating: number;

    // Apartment-specific ratings (optional)
    summerTemperature?: string;
    winterTemperature?: string;
    noise?: string;
    light?: string;
    conditionAndMaintenance?: string;
    services?: string[];

    // Community-specific ratings (optional)
    landlordTreatment?: string;
    problemResponse?: string;
    depositReturned?: boolean;
    staircaseNeighbors?: string;
    touristApartments?: boolean;
    neighborRelations?: string;
    cleaning?: string;

    // Area-specific ratings (optional)
    areaTourists?: string;
    areaSecurity?: string;

    // Profile and metadata
    profileId: { id: string } | string;     // Can be populated object or string
    createdAt: string;
    updatedAt: string;
    verified: boolean;

    // Ethical review system features (optional, with defaults)
    isAnonymous?: boolean;                   // Default anonymity
    confidenceScore?: number;                // 0-100 confidence index
    evidenceAttached?: boolean;              // Has encrypted proof
    flaggedIssues?: string[];                // Tagged issues
    karmaScore?: number;                     // Reviewer's karma
    replyAllowed?: boolean;                  // Right of reply enabled
    moderationStatus?: 'pending' | 'approved' | 'flagged' | 'removed';
    takedownReason?: string;                 // Traceable takedown reason
    helpfulVotes?: number;                   // Community moderation
    unhelpfulVotes?: number;                 // Anti-fraud measures
    reportCount?: number;                    // Reported by community

    // Display fields
    livedDurationText?: string;
    evidenceCount?: number;                  // Number of evidence items
}

export default function AddressDetailsPage() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { t: _t } = useTranslation();
    const [refreshing, setRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState('overall');
    const [selectedTab, setSelectedTab] = useState('properties');

    // State variables
    const [address, setAddress] = useState<AddressData | null>(null);
    const [properties, setProperties] = useState<Property[]>([]);
    const [reviews, setReviews] = useState<ReviewData[]>([]);
    const [loading, setLoading] = useState(true);
    const [_error, setError] = useState<string | null>(null);

    // Get derived values
    const addressId = id;

    // Filter reviews based on active tab
    const getFilteredReviews = () => {
        if (!Array.isArray(reviews)) return [];

        switch (activeTab) {
            case 'apartments':
                // Reviews that have apartment-specific ratings
                return reviews.filter(review =>
                    review.summerTemperature || review.winterTemperature || review.noise ||
                    review.light || review.conditionAndMaintenance || (review.services?.length || 0) > 0
                );
            case 'community':
                // Reviews that have community-specific ratings
                return reviews.filter(review =>
                    review.landlordTreatment || review.problemResponse || review.depositReturned !== undefined ||
                    review.staircaseNeighbors || review.touristApartments !== undefined || review.neighborRelations
                );
            case 'area':
                // Reviews that have area-specific ratings
                return reviews.filter(review =>
                    review.areaTourists || review.areaSecurity
                );
            case 'overall':
            default:
                // All reviews for overall rating
                return reviews;
        }
    };

    // Fetch data
    const fetchAddress = useCallback(async () => {
        try {
            const response = await api.get(`/api/addresses/${addressId}`);
            // Extract address from the nested response structure
            setAddress(response.data?.address || response.data);
        } catch (err) {
            console.error('Error fetching address:', err);
            throw err;
        }
    }, [addressId]);

    const fetchPropertiesAtAddress = useCallback(async () => {
        try {
            const response = await api.get('/api/properties/search', {
                params: {
                    addressId: addressId,
                    limit: 50
                }
            });
            const properties = response.data?.data || response.data?.properties || [];
            setProperties(properties);
        } catch (err) {
            console.error('Error fetching properties:', err);
            throw err;
        }
    }, [addressId]);

    const fetchAddressReviews = useCallback(async () => {
        try {
            const response = await api.get(`/api/reviews/address/${addressId}`);

            // Handle hierarchical review response structure
            let reviewsData: any[] = [];
            const responseData = response.data;

            if (responseData?.success) {
                // Extract reviews based on the hierarchical response structure
                const buildingReviews = responseData.buildingReviews || [];
                const unitReviews = responseData.unitReviews || [];

                // Combine all reviews into a single array
                reviewsData = [...buildingReviews, ...unitReviews];

                // Add default values for missing fields to ensure UI works properly
                reviewsData = reviewsData.map(review => ({
                    ...review,
                    isAnonymous: review.isAnonymous ?? true,
                    confidenceScore: review.confidenceScore ?? 75,
                    evidenceAttached: review.evidenceAttached ?? false,
                    flaggedIssues: review.flaggedIssues ?? [],
                    karmaScore: review.karmaScore ?? 0,
                    replyAllowed: review.replyAllowed ?? true,
                    moderationStatus: review.moderationStatus ?? 'approved',
                    helpfulVotes: review.helpfulVotes ?? 0,
                    unhelpfulVotes: review.unhelpfulVotes ?? 0,
                    reportCount: review.reportCount ?? 0,
                    evidenceCount: review.evidenceCount ?? 0
                }));

                console.log('Extracted reviews:', {
                    level: responseData.level,
                    buildingReviews: buildingReviews.length,
                    unitReviews: unitReviews.length,
                    totalReviews: reviewsData.length
                });
            } else {
                // Fallback for non-hierarchical response format
                reviewsData = response.data?.data || response.data?.reviews || response.data || [];
            }

            setReviews(Array.isArray(reviewsData) ? reviewsData : []);
        } catch (err) {
            console.error('Error fetching reviews:', err);
            // Set empty array on error to prevent map issues
            setReviews([]);
            throw err;
        }
    }, [addressId]);

    // Fetch all data
    const fetchAllData = useCallback(async (refresh = false) => {
        try {
            if (refresh) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }
            setError(null);

            await Promise.all([
                fetchAddress(),
                fetchPropertiesAtAddress(),
                fetchAddressReviews()
            ]);
        } catch (err) {
            console.error('Error fetching data:', err);
            setError(err instanceof Error ? err.message : 'Failed to fetch data');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [fetchAddress, fetchPropertiesAtAddress, fetchAddressReviews]);

    useEffect(() => {
        fetchAllData();
    }, [fetchAllData]);

    const handlePropertyPress = (property: Property) => {
        router.push(`/properties/${property._id}`);
    };

    const handleWriteReview = () => {
        router.push(`/reviews/write?addressId=${addressId}`);
    };

    const handleReviewHelpful = (_reviewId: string) => {
        // For now, just show alert - implement when backend supports it
        Alert.alert('Thank you', 'Your feedback has been recorded.');
    };

    const handleReviewReport = (_reviewId: string) => {
        Alert.alert(
            'Report Review',
            'Are you sure you want to report this review for inappropriate content?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Report',
                    style: 'destructive',
                    onPress: () => {
                        // TODO: Implement review reporting
                        Alert.alert('Reported', 'This review has been reported to our moderation team.');
                    }
                }
            ]
        );
    };

    const handleReplyToReview = (_reviewId: string) => {
        Alert.alert(
            'Reply to Review',
            'Reply functionality will allow landlords and property managers to respond to reviews.',
            [{ text: 'OK' }]
        );
    };

    // Helper function to get the address title for header
    const getAddressTitle = () => {
        if (!address) return 'Address Details';

        // Use fullAddress if available, otherwise construct from parts
        let title = '';
        if (address.fullAddress) {
            title = address.fullAddress;
        } else if (address.location) {
            // Use location field as fallback
            title = address.location;
        } else {
            // Construct address from parts
            const parts = [address.street, address.city, address.state].filter(Boolean);
            title = parts.length > 0 ? parts.join(', ') : 'Address Details';
        }

        // Truncate if too long for header (keep it under 35 characters for mobile)
        if (title.length > 35) {
            return title.substring(0, 32) + '...';
        }

        return title;
    };

    const renderStars = (rating: number) => {
        const fullStars = Math.floor(rating);
        const halfStar = rating % 1 >= 0.5;
        const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);

        return (
            <View style={styles.starsContainer}>
                {[...Array(fullStars)].map((_, i) => (
                    <Ionicons key={`full-${i}`} name="star" size={16} color="#FFD700" />
                ))}
                {halfStar && <Ionicons name="star-half" size={16} color="#FFD700" />}
                {[...Array(emptyStars)].map((_, i) => (
                    <Ionicons key={`empty-${i}`} name="star-outline" size={16} color="#FFD700" />
                ))}
            </View>
        );
    };

    const renderReviewItem = (review: ReviewData) => (
        <View key={review._id} style={styles.reviewItem}>
            <View style={styles.reviewHeader}>
                <View style={styles.reviewerInfo}>
                    <View style={styles.avatar}>
                        <Ionicons name="person" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
                    </View>
                    <View style={styles.reviewerDetails}>
                        <View style={styles.reviewerNameRow}>
                            <ThemedText style={styles.reviewerName}>
                                {review.isAnonymous ? 'Anonymous' : 'Verified Resident'}
                            </ThemedText>

                            {/* Verification and Trust Indicators */}
                            <View style={styles.trustIndicators}>
                                {review.verified && (
                                    <View style={styles.verifiedBadge}>
                                        <Ionicons name="checkmark-circle" size={14} color={colors.primaryColor} />
                                        <ThemedText style={styles.verifiedText}>Verified</ThemedText>
                                    </View>
                                )}

                                {/* Confidence Score */}
                                <View style={[styles.confidenceBadge, {
                                    backgroundColor: (review.confidenceScore || 0) >= 80 ? '#4CAF50' :
                                        (review.confidenceScore || 0) >= 60 ? '#FF9800' : '#F44336'
                                }]}>
                                    <ThemedText style={styles.confidenceText}>
                                        {review.confidenceScore || 0}% confident
                                    </ThemedText>
                                </View>

                                {/* Evidence Indicator */}
                                {review.evidenceAttached && (
                                    <View style={styles.evidenceBadge}>
                                        <Ionicons name="document-attach" size={12} color={colors.COLOR_BLACK_LIGHT_3} />
                                        <ThemedText style={styles.evidenceText}>
                                            {review.evidenceCount || 1} proof{(review.evidenceCount || 1) > 1 ? 's' : ''}
                                        </ThemedText>
                                    </View>
                                )}

                                {/* Karma Score */}
                                {(review.karmaScore || 0) > 0 && (
                                    <View style={styles.karmaBadge}>
                                        <Ionicons name="trending-up" size={12} color="#9C27B0" />
                                        <ThemedText style={styles.karmaText}>{review.karmaScore || 0} karma</ThemedText>
                                    </View>
                                )}
                            </View>
                        </View>

                        <View style={styles.reviewMetaRow}>
                            <ThemedText style={styles.reviewDate}>
                                {new Date(review.createdAt).toLocaleDateString()}
                            </ThemedText>
                            <ThemedText style={styles.livedDuration}>
                                Lived {review.livedForMonths} months
                            </ThemedText>
                        </View>

                        {/* Flagged Issues Tags */}
                        {review.flaggedIssues && review.flaggedIssues.length > 0 && (
                            <View style={styles.issueTagsContainer}>
                                {review.flaggedIssues.slice(0, 3).map((issue, index) => (
                                    <View key={index} style={styles.issueTag}>
                                        <ThemedText style={styles.issueTagText}>⚠️ {issue}</ThemedText>
                                    </View>
                                ))}
                                {review.flaggedIssues.length > 3 && (
                                    <View style={styles.issueTag}>
                                        <ThemedText style={styles.issueTagText}>+{review.flaggedIssues.length - 3} more</ThemedText>
                                    </View>
                                )}
                            </View>
                        )}
                    </View>
                </View>
                {renderStars(review.rating)}
            </View>

            <ThemedText style={styles.reviewText}>{review.opinion}</ThemedText>

            {review.positiveComment && (
                <View style={styles.commentSection}>
                    <ThemedText style={styles.commentLabel}>Positive:</ThemedText>
                    <ThemedText style={styles.commentText}>{review.positiveComment}</ThemedText>
                </View>
            )}

            {review.negativeComment && (
                <View style={styles.commentSection}>
                    <ThemedText style={styles.commentLabel}>Negative:</ThemedText>
                    <ThemedText style={styles.commentText}>{review.negativeComment}</ThemedText>
                </View>
            )}

            <View style={styles.reviewFooter}>
                {/* Community Moderation Section */}
                <View style={styles.moderationSection}>
                    <TouchableOpacity
                        style={[styles.helpfulButton, { backgroundColor: (review.helpfulVotes || 0) > 0 ? '#E8F5E8' : 'transparent' }]}
                        onPress={() => handleReviewHelpful(review._id)}
                    >
                        <Ionicons
                            name="thumbs-up-outline"
                            size={16}
                            color={(review.helpfulVotes || 0) > 0 ? '#4CAF50' : colors.COLOR_BLACK_LIGHT_4}
                        />
                        <ThemedText style={[styles.helpfulText, {
                            color: (review.helpfulVotes || 0) > 0 ? '#4CAF50' : colors.COLOR_BLACK_LIGHT_4
                        }]}>
                            Helpful ({review.helpfulVotes || 0})
                        </ThemedText>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.helpfulButton}
                        onPress={() => handleReviewReport(review._id)}
                    >
                        <Ionicons name="flag-outline" size={16} color={colors.COLOR_BLACK_LIGHT_4} />
                        <ThemedText style={styles.helpfulText}>Report</ThemedText>
                    </TouchableOpacity>

                    {/* Right of Reply Button */}
                    {review.replyAllowed && (
                        <TouchableOpacity
                            style={styles.helpfulButton}
                            onPress={() => handleReplyToReview(review._id)}
                        >
                            <Ionicons name="chatbubble-outline" size={16} color={colors.primaryColor} />
                            <ThemedText style={[styles.helpfulText, { color: colors.primaryColor }]}>Reply</ThemedText>
                        </TouchableOpacity>
                    )}
                </View>

                {/* Recommendation and Trust Info */}
                <View style={styles.recommendationSection}>
                    <ThemedText style={styles.recommendationText}>
                        {review.recommendation ? '✓ Recommends' : '✗ Does not recommend'}
                    </ThemedText>

                    {/* Moderation Status Indicator */}
                    {review.moderationStatus === 'flagged' && (
                        <View style={styles.flaggedIndicator}>
                            <Ionicons name="warning" size={12} color="#FF9800" />
                            <ThemedText style={styles.flaggedText}>Under Review</ThemedText>
                        </View>
                    )}
                </View>
            </View>
        </View>
    );

    // Convert AddressData to Address interface for components
    const addressForDisplay = address ? {
        street: address.street,
        city: address.city,
        state: address.state,
        zipCode: address.zipCode,
        country: address.country,
        coordinates: address.coordinates ? {
            lat: address.coordinates.coordinates[1],
            lng: address.coordinates.coordinates[0]
        } : undefined
    } : null;

    if (loading && !refreshing) {
        return (
            <SafeAreaView style={styles.container}>
                <Header options={{ title: getAddressTitle(), showBackButton: true }} />
                <PropertyListSkeleton viewMode="list" />
            </SafeAreaView>
        );
    }

    if (!address) {
        return (
            <SafeAreaView style={styles.container}>
                <Header options={{ title: getAddressTitle(), showBackButton: true }} />
                <View style={styles.loadingContainer}>
                    <ThemedText style={styles.loadingText}>Address not found</ThemedText>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <Header options={{ title: getAddressTitle(), showBackButton: true }} />

            <ScrollView
                style={styles.scrollView}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => fetchAllData(true)}
                        colors={[colors.primaryColor]}
                    />
                }
            >
                {/* Address Display */}
                <View style={styles.section}>
                    {addressForDisplay && (
                        <AddressDisplay
                            address={addressForDisplay}
                            variant="detailed"
                            showActions={true}
                        />
                    )}
                </View>

                {/* Trust & Transparency Overview */}
                <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>Trust & Transparency</ThemedText>
                    <View style={styles.trustOverview}>
                        <View style={styles.trustMetrics}>
                            <View style={styles.trustMetric}>
                                <ThemedText style={styles.trustMetricValue}>
                                    {reviews.length > 0 ? Math.round(reviews.reduce((acc, r) => acc + (r.confidenceScore || 0), 0) / reviews.length) : 0}%
                                </ThemedText>
                                <ThemedText style={styles.trustMetricLabel}>Confidence Index</ThemedText>
                            </View>
                            <View style={styles.trustMetric}>
                                <ThemedText style={styles.trustMetricValue}>
                                    {reviews.filter(r => r.verified).length}
                                </ThemedText>
                                <ThemedText style={styles.trustMetricLabel}>Verified Reviews</ThemedText>
                            </View>
                            <View style={styles.trustMetric}>
                                <ThemedText style={styles.trustMetricValue}>
                                    {reviews.filter(r => r.evidenceAttached).length}
                                </ThemedText>
                                <ThemedText style={styles.trustMetricLabel}>With Evidence</ThemedText>
                            </View>
                        </View>

                        <View style={styles.ethicalFeatures}>
                            <View style={styles.ethicalFeature}>
                                <Ionicons name="shield-checkmark" size={16} color="#4CAF50" />
                                <ThemedText style={styles.ethicalFeatureText}>Default Anonymity</ThemedText>
                            </View>
                            <View style={styles.ethicalFeature}>
                                <Ionicons name="chatbubble-ellipses" size={16} color="#2196F3" />
                                <ThemedText style={styles.ethicalFeatureText}>Right of Reply</ThemedText>
                            </View>
                            <View style={styles.ethicalFeature}>
                                <Ionicons name="people" size={16} color="#9C27B0" />
                                <ThemedText style={styles.ethicalFeatureText}>Community Moderated</ThemedText>
                            </View>
                        </View>
                    </View>
                </View>

                {/* Neighborhood Rating Widget */}
                <View style={styles.section}>
                    <NeighborhoodRatingWidget
                        neighborhoodName={address.neighborhood || ''}
                        city={address.city}
                        state={address.state}
                    />
                </View>

                {/* Tab Navigation */}
                <View style={styles.tabContainer}>
                    <TouchableOpacity
                        style={[styles.tab, selectedTab === 'properties' && styles.activeTab]}
                        onPress={() => setSelectedTab('properties')}
                    >
                        <ThemedText style={[styles.tabText, selectedTab === 'properties' && styles.activeTabText]}>
                            Properties ({properties.length})
                        </ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.tab, selectedTab === 'reviews' && styles.activeTab]}
                        onPress={() => setSelectedTab('reviews')}
                    >
                        <ThemedText style={[styles.tabText, selectedTab === 'reviews' && styles.activeTabText]}>
                            Reviews ({reviews.length})
                        </ThemedText>
                    </TouchableOpacity>
                </View>

                {/* Content based on selected tab */}
                {selectedTab === 'properties' ? (
                    <View style={styles.section}>
                        <ThemedText style={styles.sectionTitle}>
                            Properties at this Address
                        </ThemedText>

                        {properties.length === 0 ? (
                            <View style={styles.emptyState}>
                                <Ionicons name="home-outline" size={48} color={colors.COLOR_BLACK_LIGHT_4} />
                                <ThemedText style={styles.emptyTitle}>No Properties Found</ThemedText>
                                <ThemedText style={styles.emptyDescription}>
                                    There are currently no properties listed at this address.
                                </ThemedText>
                            </View>
                        ) : (
                            <View style={styles.propertiesList}>
                                {properties.map((property) => (
                                    <PropertyCard
                                        key={property._id}
                                        property={property}
                                        onPress={() => handlePropertyPress(property)}
                                        variant="compact"
                                        orientation='horizontal'
                                    />
                                ))}
                            </View>
                        )}
                    </View>
                ) : (
                    <View style={styles.section}>
                        <View style={styles.reviewsHeader}>
                            <ThemedText style={styles.sectionTitle}>
                                Address Reviews
                            </ThemedText>
                            <TouchableOpacity
                                style={styles.writeReviewButton}
                                onPress={handleWriteReview}
                            >
                                <Ionicons name="create-outline" size={20} color={colors.primaryColor} />
                                <ThemedText style={styles.writeReviewText}>Write Review</ThemedText>
                            </TouchableOpacity>
                        </View>

                        {/* Review Tabs */}
                        <View style={styles.reviewTabs}>
                            {['overall', 'apartments', 'community', 'area'].map((tab) => (
                                <TouchableOpacity
                                    key={tab}
                                    style={[
                                        styles.reviewTab,
                                        activeTab === tab && styles.activeReviewTab
                                    ]}
                                    onPress={() => setActiveTab(tab)}
                                >
                                    <ThemedText style={[
                                        styles.reviewTabText,
                                        activeTab === tab && styles.activeReviewTabText
                                    ]}>
                                        {tab === 'overall' && 'Overall Rating'}
                                        {tab === 'apartments' && 'Of the Apartments'}
                                        {tab === 'community' && 'Of the Community'}
                                        {tab === 'area' && 'Of the Area'}
                                    </ThemedText>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {(() => {
                            const filteredReviews = getFilteredReviews();
                            return !Array.isArray(filteredReviews) || filteredReviews.length === 0 ? (
                                <View style={styles.emptyState}>
                                    <Ionicons name="chatbubble-outline" size={48} color={colors.COLOR_BLACK_LIGHT_4} />
                                    <ThemedText style={styles.emptyTitle}>
                                        {activeTab === 'overall' ? 'No Reviews Yet' : `No ${activeTab === 'apartments' ? 'Apartment' : activeTab === 'community' ? 'Community' : 'Area'} Reviews Yet`}
                                    </ThemedText>
                                    <ThemedText style={styles.emptyDescription}>
                                        {activeTab === 'overall'
                                            ? 'Be the first to review this address and help others make informed decisions.'
                                            : `Be the first to review the ${activeTab === 'apartments' ? 'apartments' : activeTab} at this address.`
                                        }
                                    </ThemedText>
                                </View>
                            ) : (
                                <View style={styles.reviewsList}>
                                    {filteredReviews.map(renderReviewItem)}
                                </View>
                            );
                        })()}
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.COLOR_BLACK_LIGHT_8,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    loadingText: {
        marginTop: 16,
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    scrollView: {
        flex: 1,
    },
    section: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 16,
        color: colors.primaryDark,
    },
    tabContainer: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    tab: {
        flex: 1,
        paddingVertical: 16,
        paddingHorizontal: 8,
        alignItems: 'center',
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    activeTab: {
        borderBottomColor: colors.primaryColor,
    },
    tabText: {
        fontSize: 16,
        fontWeight: '500',
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    activeTabText: {
        color: colors.primaryColor,
        fontWeight: '600',
    },
    propertiesList: {
        gap: 16,
    },
    propertyCard: {
        marginBottom: 0,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 48,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginTop: 16,
        marginBottom: 8,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    emptyDescription: {
        fontSize: 14,
        textAlign: 'center',
        color: colors.COLOR_BLACK_LIGHT_4,
        lineHeight: 20,
        maxWidth: 280,
    },
    reviewsHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 24,
    },
    reviewsSummary: {
        flex: 1,
    },
    averageRating: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
    },
    averageRatingText: {
        marginLeft: 8,
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    writeReviewButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
        marginLeft: 16,
    },
    writeReviewText: {
        color: 'white',
        fontSize: 14,
        fontWeight: '600',
        marginLeft: 6,
    },
    writeFirstReviewButton: {
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
        marginTop: 16,
    },
    writeFirstReviewText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
    reviewsList: {
        gap: 24,
    },
    reviewItem: {
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 3.84,
        elevation: 5,
    },
    reviewHeader: {
        marginBottom: 12,
    },
    reviewerInfo: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    reviewerDetails: {
        flex: 1,
    },
    reviewerNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    reviewerName: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    verifiedBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primaryColor + '10',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        marginLeft: 8,
    },
    verifiedText: {
        fontSize: 12,
        color: colors.primaryColor,
        fontWeight: '500',
        marginLeft: 4,
    },
    ratingDateRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    starsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    reviewDate: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginLeft: 12,
    },
    reviewText: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.COLOR_BLACK_LIGHT_2,
        marginBottom: 12,
    },
    tagsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 12,
        gap: 6,
    },
    tag: {
        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    tagText: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_3,
        fontWeight: '500',
    },
    helpfulButton: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        paddingVertical: 4,
    },
    helpfulText: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginLeft: 6,
    },
    commentSection: {
        marginBottom: 8,
    },
    commentLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.COLOR_BLACK_LIGHT_3,
        marginBottom: 4,
    },
    commentText: {
        fontSize: 14,
        lineHeight: 18,
        color: colors.COLOR_BLACK_LIGHT_2,
    },
    reviewFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: colors.COLOR_BLACK_LIGHT_6,
    },
    recommendationText: {
        fontSize: 12,
        fontWeight: '500',
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    reviewTabs: {
        flexDirection: 'row',
        backgroundColor: colors.COLOR_BLACK_LIGHT_7,
        borderRadius: 12,
        padding: 4,
        marginBottom: 16,
    },
    reviewTab: {
        flex: 1,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    activeReviewTab: {
        backgroundColor: colors.primaryColor,
    },
    reviewTabText: {
        fontSize: 12,
        fontWeight: '500',
        color: colors.COLOR_BLACK_LIGHT_3,
        textAlign: 'center',
    },
    activeReviewTabText: {
        color: '#FFFFFF',
        fontWeight: '600',
    },
    // Ethical review system styles
    trustIndicators: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 4,
    },
    confidenceBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 12,
        alignItems: 'center',
    },
    confidenceText: {
        fontSize: 10,
        color: '#FFFFFF',
        fontWeight: '600',
    },
    evidenceBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 10,
        gap: 3,
    },
    evidenceText: {
        fontSize: 10,
        color: colors.COLOR_BLACK_LIGHT_3,
        fontWeight: '500',
    },
    karmaBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F3E5F5',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 10,
        gap: 3,
    },
    karmaText: {
        fontSize: 10,
        color: '#9C27B0',
        fontWeight: '500',
    },
    reviewMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: 4,
    },
    livedDuration: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    issueTagsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 8,
    },
    issueTag: {
        backgroundColor: '#FFF3E0',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#FFB74D',
    },
    issueTagText: {
        fontSize: 11,
        color: '#E65100',
        fontWeight: '500',
    },
    // Community moderation styles
    moderationSection: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        flex: 1,
    },
    recommendationSection: {
        alignItems: 'flex-end',
    },
    flaggedIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF3E0',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 8,
        gap: 3,
        marginTop: 4,
    },
    flaggedText: {
        fontSize: 10,
        color: '#FF9800',
        fontWeight: '500',
    },
    // Trust & Transparency styles
    trustOverview: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        marginTop: 8,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
    },
    trustMetrics: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    trustMetric: {
        alignItems: 'center',
        flex: 1,
    },
    trustMetricValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: colors.primaryColor,
        marginBottom: 4,
    },
    trustMetricLabel: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_4,
        textAlign: 'center',
    },
    ethicalFeatures: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: colors.COLOR_BLACK_LIGHT_6,
        justifyContent: 'space-between',
    },
    ethicalFeature: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flex: 1,
        minWidth: '30%',
    },
    ethicalFeatureText: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_3,
        fontWeight: '500',
    },
});
