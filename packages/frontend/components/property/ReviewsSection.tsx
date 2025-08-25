/**
 * ReviewsSection Component
 * Displays building-level reviews for a property with option to see all reviews
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    StyleSheet,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '../ThemedText';
import { ReviewCard, ReviewData } from '../ReviewCard';
import Button from '../Button';
import { colors } from '@/styles/colors';
import { useOxy } from '@oxyhq/services';
import { api } from '@/utils/api';
import type { Property } from '@homiio/shared-types';

interface ReviewsSectionProps {
    property: Property;
    variant?: 'full' | 'preview';
}

export const ReviewsSection: React.FC<ReviewsSectionProps> = ({
    property,
    variant = 'preview'
}) => {
    const router = useRouter();
    const { oxyServices, activeSessionId } = useOxy();
    const [reviews, setReviews] = useState<ReviewData[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [aggregatedStats, setAggregatedStats] = useState<{
        averageRating: number;
        totalReviews: number;
        recommendationPercentage: number;
    } | null>(null);

    const isPreview = variant === 'preview';
    const maxReviewsToShow = isPreview ? 3 : 10;

    // Get address ID from property
    const addressId = (property?.address as any)?._id || (property?.address as any)?.id;

    console.log('ReviewsSection - Component props:', {
        hasProperty: !!property,
        addressId,
        propertyAddress: property?.address,
        hasAuth: !!(oxyServices && activeSessionId)
    });

    const fetchPropertyReviews = useCallback(async () => {
        if (!addressId) return;

        if (!oxyServices || !activeSessionId) {
            setError('Please sign in to view reviews');
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const response = await api.get(`/api/reviews/address/${addressId}`, {
                oxyServices,
                activeSessionId
            });

            // Handle hierarchical response structure
            const data = response.data;
            console.log('ReviewsSection - API Response:', data);

            // Handle both nested and direct response formats
            const responseData = data.success ? data : data.data || data;
            const buildingReviews = responseData.buildingReviews || [];
            const unitReviews = responseData.unitReviews || [];
            const allReviews = [...buildingReviews, ...unitReviews];

            console.log('ReviewsSection - Extracted reviews:', {
                buildingReviews: buildingReviews.length,
                unitReviews: unitReviews.length,
                totalReviews: allReviews.length,
                reviews: allReviews
            });

            // Add default values for any missing fields that ReviewCard might need
            const processedReviews = allReviews.map(review => ({
                ...review,
                // Ensure all optional fields have defaults
                positiveComment: review.positiveComment || '',
                negativeComment: review.negativeComment || '',
                images: review.images || [],
                services: review.services || [],
                // Ethical review system defaults
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

            setReviews(processedReviews);

            // Calculate aggregated stats
            if (allReviews.length > 0) {
                const avgRating = allReviews.reduce((sum: number, review: any) => sum + (review.rating || 0), 0) / allReviews.length;
                const recommendedCount = allReviews.filter((review: any) => review.rating >= 4).length;

                setAggregatedStats({
                    averageRating: avgRating,
                    totalReviews: allReviews.length,
                    recommendationPercentage: (recommendedCount / allReviews.length) * 100
                });
            }
        } catch (error) {
            console.error('Error fetching property reviews:', error);
            setError('Failed to load reviews');
        } finally {
            setLoading(false);
        }
    }, [addressId, oxyServices, activeSessionId]);

    useEffect(() => {
        fetchPropertyReviews();
    }, [fetchPropertyReviews]);

    const handleViewAllReviews = () => {
        if (addressId) {
            router.push(`/addresses/${addressId}?tab=reviews`);
        }
    };

    const handleWriteReview = () => {
        if (addressId) {
            router.push(`/reviews/write?addressId=${addressId}`);
        }
    };

    const handleReviewHelpful = (_reviewId: string) => {
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
                        Alert.alert('Reported', 'This review has been reported to our moderation team.');
                    }
                }
            ]
        );
    };

    const handleReviewReply = (_reviewId: string) => {
        Alert.alert(
            'Reply to Review',
            'Reply functionality will allow landlords and property managers to respond to reviews.',
            [{ text: 'OK' }]
        );
    };

    if (!addressId) {
        return null;
    }

    // Don't show the section if there are no reviews and not loading
    if (!loading && !error && reviews.length === 0) {
        return null;
    }

    const reviewsToShow = reviews.slice(0, maxReviewsToShow);
    const hasMoreReviews = reviews.length > maxReviewsToShow;

    return (
        <View style={styles.container}>
            <ThemedText style={styles.sectionTitle}>Building Reviews</ThemedText>
            <ThemedText style={styles.disclaimer}>
                These are ethical, community-verified reviews about the building itself, not this specific property.
                They provide helpful insights from residents who have lived in the same building, though experiences may vary by unit.
            </ThemedText>

            <View style={styles.card}>
                {/* Loading State */}
                {loading && (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="small" color={colors.primaryColor} />
                        <ThemedText style={styles.loadingText}>Loading reviews...</ThemedText>
                    </View>
                )}

                {/* Error State */}
                {error && (
                    <View style={styles.errorContainer}>
                        <Ionicons name="alert-circle-outline" size={24} color={colors.COLOR_BLACK_LIGHT_4} />
                        <ThemedText style={styles.errorText}>{error}</ThemedText>
                        <Button onPress={fetchPropertyReviews}>
                            Retry
                        </Button>
                    </View>
                )}

                {/* Reviews Content */}
                {!loading && !error && (
                    <>
                        {/* Rating Summary */}
                        {aggregatedStats && (
                            <View style={styles.ratingContainer}>
                                <View style={styles.starsContainer}>
                                    {[...Array(5)].map((_, i) => (
                                        <Ionicons
                                            key={i}
                                            name={i < Math.floor(aggregatedStats.averageRating) ? "star" : "star-outline"}
                                            size={16}
                                            color="#FFD700"
                                        />
                                    ))}
                                </View>
                                <ThemedText style={styles.ratingText}>
                                    {aggregatedStats.averageRating.toFixed(1)} ({aggregatedStats.totalReviews} reviews)
                                </ThemedText>
                            </View>
                        )}

                        {/* Reviews List */}
                        <View style={styles.reviewsList}>
                            {reviewsToShow.map((review) => (
                                <ReviewCard
                                    key={review._id}
                                    review={review}
                                    onHelpful={handleReviewHelpful}
                                    onReport={handleReviewReport}
                                    onReply={handleReviewReply}
                                    variant={isPreview ? 'compact' : 'default'}
                                    showActions={!isPreview}
                                />
                            ))}
                        </View>

                        {/* View All Button */}
                        {isPreview && (hasMoreReviews || reviews.length > 0) && (
                            <Button
                                onPress={handleViewAllReviews}
                                backgroundColor={colors.primaryLight_2}
                                textColor={colors.primaryColor}
                            >
                                View All Reviews ({reviews.length}) →
                            </Button>
                        )}

                        {/* Trust Summary */}
                        {aggregatedStats && isPreview && (
                            <View style={styles.trustSummary}>
                                <View style={styles.trustMetric}>
                                    <ThemedText style={styles.trustMetricValue}>
                                        {Math.round(aggregatedStats.recommendationPercentage)}%
                                    </ThemedText>
                                    <ThemedText style={styles.trustMetricLabel}>Recommend</ThemedText>
                                </View>
                                <View style={styles.trustMetric}>
                                    <ThemedText style={styles.trustMetricValue}>
                                        {reviews.filter(r => r.verified).length}
                                    </ThemedText>
                                    <ThemedText style={styles.trustMetricLabel}>Verified</ThemedText>
                                </View>
                                <View style={styles.trustMetric}>
                                    <ThemedText style={styles.trustMetricValue}>
                                        {reviews.filter(r => r.evidenceAttached).length}
                                    </ThemedText>
                                    <ThemedText style={styles.trustMetricLabel}>With Evidence</ThemedText>
                                </View>
                            </View>
                        )}

                        {/* Write Review Button */}
                        <Button
                            onPress={handleWriteReview}
                            backgroundColor={colors.primaryLight_2}
                            textColor={colors.primaryColor}
                        >
                            ✏️ Write Review
                        </Button>
                    </>
                )}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginBottom: 20,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 15,
    },
    disclaimer: {
        fontSize: 12,
        fontStyle: 'italic',
        marginBottom: 12,
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    card: {
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
    ratingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 16,
    },
    starsContainer: {
        flexDirection: 'row',
        gap: 2,
    },
    ratingText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    loadingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 32,
        gap: 8,
    },
    loadingText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    errorContainer: {
        alignItems: 'center',
        paddingVertical: 32,
        gap: 8,
    },
    errorText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
        textAlign: 'center',
    },
    reviewsList: {
        gap: 12,
        marginBottom: 16,
    },
    trustSummary: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: colors.COLOR_BLACK_LIGHT_6,
    },
    trustMetric: {
        alignItems: 'center',
    },
    trustMetricValue: {
        fontSize: 20,
        fontWeight: 'bold',
        color: colors.primaryColor,
        marginBottom: 4,
    },
    trustMetricLabel: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_4,
        textAlign: 'center',
    },
});

export default ReviewsSection;
