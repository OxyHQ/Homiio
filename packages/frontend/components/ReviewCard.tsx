/**
 * ReviewCard Component
 * Reusable component for displaying review data with ethical review system features
 */

import React from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from './ThemedText';
import { colors } from '@/styles/colors';

export interface ReviewData {
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
    profileId: { id: string } | string;
    createdAt: string;
    updatedAt: string;
    verified: boolean;

    // Ethical review system features (optional, with defaults)
    isAnonymous?: boolean;
    confidenceScore?: number;
    evidenceAttached?: boolean;
    flaggedIssues?: string[];
    karmaScore?: number;
    replyAllowed?: boolean;
    moderationStatus?: 'pending' | 'approved' | 'flagged' | 'removed';
    takedownReason?: string;
    helpfulVotes?: number;
    unhelpfulVotes?: number;
    reportCount?: number;

    // Display fields
    livedDurationText?: string;
    evidenceCount?: number;
}

interface ReviewCardProps {
    review: ReviewData;
    onHelpful?: (reviewId: string) => void;
    onReport?: (reviewId: string) => void;
    onReply?: (reviewId: string) => void;
    variant?: 'default' | 'compact';
    showActions?: boolean;
}

export const ReviewCard: React.FC<ReviewCardProps> = ({
    review,
    onHelpful,
    onReport,
    onReply,
    variant = 'default',
    showActions = true
}) => {
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

    const handleHelpful = () => {
        if (onHelpful) {
            onHelpful(review._id);
        } else {
            Alert.alert('Thank you', 'Your feedback has been recorded.');
        }
    };

    const handleReport = () => {
        if (onReport) {
            onReport(review._id);
        } else {
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
        }
    };

    const handleReply = () => {
        if (onReply) {
            onReply(review._id);
        } else {
            Alert.alert(
                'Reply to Review',
                'Reply functionality will allow landlords and property managers to respond to reviews.',
                [{ text: 'OK' }]
            );
        }
    };

    const isCompact = variant === 'compact';

    return (
        <View style={[styles.reviewCard, isCompact && styles.compactCard]}>
            <View style={styles.reviewHeader}>
                <View style={styles.reviewerInfo}>
                    <View style={styles.avatar}>
                        <Ionicons name="person" size={24} color={colors.primaryColor} />
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
                                {!isCompact && (
                                    <View style={[styles.confidenceBadge, {
                                        backgroundColor: (review.confidenceScore || 0) >= 80 ? '#4CAF50' :
                                            (review.confidenceScore || 0) >= 60 ? '#FF9800' : '#F44336'
                                    }]}>
                                        <ThemedText style={styles.confidenceText}>
                                            {review.confidenceScore || 0}% confident
                                        </ThemedText>
                                    </View>
                                )}

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
                                {!isCompact && (review.karmaScore || 0) > 0 && (
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
                            {review.price && (
                                <ThemedText style={styles.price}>
                                    {review.price} {review.currency}/month
                                </ThemedText>
                            )}
                        </View>

                        {/* Flagged Issues Tags */}
                        {!isCompact && review.flaggedIssues && review.flaggedIssues.length > 0 && (
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

            <ThemedText style={[styles.reviewText, isCompact && styles.compactReviewText]} numberOfLines={isCompact ? 3 : undefined}>
                {review.opinion}
            </ThemedText>

            {!isCompact && review.positiveComment && (
                <View style={styles.commentSection}>
                    <ThemedText style={styles.commentLabel}>Positive:</ThemedText>
                    <ThemedText style={styles.commentText}>{review.positiveComment}</ThemedText>
                </View>
            )}

            {!isCompact && review.negativeComment && (
                <View style={styles.commentSection}>
                    <ThemedText style={styles.commentLabel}>Negative:</ThemedText>
                    <ThemedText style={styles.commentText}>{review.negativeComment}</ThemedText>
                </View>
            )}

            {showActions && (
                <View style={styles.reviewFooter}>
                    {/* Community Moderation Section */}
                    <View style={styles.moderationSection}>
                        <TouchableOpacity
                            style={[styles.helpfulButton, {
                                backgroundColor: (review.helpfulVotes || 0) > 0 ? '#e8f5e8' : '#f8fafc',
                                borderColor: (review.helpfulVotes || 0) > 0 ? '#4CAF50' : '#e2e8f0'
                            }]}
                            onPress={handleHelpful}
                        >
                            <Ionicons
                                name="thumbs-up"
                                size={18}
                                color={(review.helpfulVotes || 0) > 0 ? '#4CAF50' : colors.COLOR_BLACK_LIGHT_4}
                            />
                            <ThemedText style={[styles.helpfulText, {
                                color: (review.helpfulVotes || 0) > 0 ? '#2e7d32' : colors.COLOR_BLACK_LIGHT_4
                            }]}>
                                Helpful ({review.helpfulVotes || 0})
                            </ThemedText>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.helpfulButton, {
                                backgroundColor: '#f8fafc',
                                borderColor: '#e2e8f0'
                            }]}
                            onPress={handleReport}
                        >
                            <Ionicons name="flag" size={18} color="#ef4444" />
                            <ThemedText style={[styles.helpfulText, { color: '#ef4444' }]}>Report</ThemedText>
                        </TouchableOpacity>

                        {/* Right of Reply Button */}
                        {review.replyAllowed && (
                            <TouchableOpacity
                                style={[styles.helpfulButton, {
                                    backgroundColor: colors.primaryLight_2,
                                    borderColor: colors.primaryColor
                                }]}
                                onPress={handleReply}
                            >
                                <Ionicons name="chatbubble" size={18} color={colors.primaryColor} />
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
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    reviewCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#e9ecef',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
    },
    compactCard: {
        padding: 16,
        marginBottom: 12,
        borderRadius: 14,
    },
    reviewHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 16,
    },
    reviewerInfo: {
        flexDirection: 'row',
        flex: 1,
        marginRight: 12,
    },
    avatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: colors.primaryLight_2,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
        borderWidth: 2,
        borderColor: colors.primaryColor,
    },
    reviewerDetails: {
        flex: 1,
    },
    reviewerNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
    },
    reviewerName: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.primaryDark,
    },
    trustIndicators: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
    },
    verifiedBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#e8f5e8',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 12,
        gap: 4,
        borderWidth: 1,
        borderColor: '#4CAF50',
    },
    verifiedText: {
        fontSize: 11,
        color: '#2e7d32',
        fontWeight: '700',
    },
    confidenceBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 14,
        alignItems: 'center',
    },
    confidenceText: {
        fontSize: 11,
        color: '#FFFFFF',
        fontWeight: '700',
    },
    evidenceBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f0f4f8',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 12,
        gap: 4,
        borderWidth: 1,
        borderColor: '#cbd5e0',
    },
    evidenceText: {
        fontSize: 11,
        color: '#4a5568',
        fontWeight: '600',
    },
    karmaBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f3e8ff',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 12,
        gap: 4,
        borderWidth: 1,
        borderColor: '#9C27B0',
    },
    karmaText: {
        fontSize: 11,
        color: '#7c3aed',
        fontWeight: '600',
    },
    reviewMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        marginTop: 6,
    },
    reviewDate: {
        fontSize: 13,
        color: colors.COLOR_BLACK_LIGHT_4,
        fontWeight: '500',
    },
    livedDuration: {
        fontSize: 13,
        color: colors.COLOR_BLACK_LIGHT_4,
        fontWeight: '500',
    },
    price: {
        fontSize: 13,
        color: colors.primaryColor,
        fontWeight: '700',
        backgroundColor: colors.primaryLight_2,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 8,
    },
    issueTagsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 12,
    },
    issueTag: {
        backgroundColor: '#fff4e6',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#ff9800',
    },
    issueTagText: {
        fontSize: 12,
        color: '#e65100',
        fontWeight: '600',
    },
    starsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: '#fff9e6',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#ffd700',
    },
    reviewText: {
        fontSize: 16,
        lineHeight: 24,
        color: colors.COLOR_BLACK_LIGHT_2,
        marginBottom: 16,
        fontWeight: '400',
    },
    compactReviewText: {
        fontSize: 14,
        lineHeight: 20,
        marginBottom: 12,
    },
    commentSection: {
        marginBottom: 12,
        backgroundColor: '#f8fafc',
        padding: 12,
        borderRadius: 12,
        borderLeftWidth: 4,
        borderLeftColor: colors.primaryColor,
    },
    commentLabel: {
        fontSize: 13,
        fontWeight: '700',
        color: colors.primaryColor,
        marginBottom: 6,
        textTransform: 'uppercase',
    },
    commentText: {
        fontSize: 14,
        lineHeight: 20,
        color: colors.COLOR_BLACK_LIGHT_2,
    },
    reviewFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#e9ecef',
    },
    moderationSection: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        flex: 1,
    },
    helpfulButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    helpfulText: {
        fontSize: 13,
        fontWeight: '600',
    },
    recommendationSection: {
        alignItems: 'flex-end',
    },
    recommendationText: {
        fontSize: 14,
        fontWeight: '700',
        color: colors.primaryDark,
        backgroundColor: colors.primaryLight_2,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
        overflow: 'hidden',
    },
    flaggedIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff4e6',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 10,
        gap: 4,
        marginTop: 6,
        borderWidth: 1,
        borderColor: '#ff9800',
    },
    flaggedText: {
        fontSize: 11,
        color: '#e65100',
        fontWeight: '600',
    },
});

export default ReviewCard;
