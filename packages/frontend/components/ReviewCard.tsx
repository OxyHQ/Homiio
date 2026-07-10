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
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from './ThemedText';
import { colors } from '@/styles/colors';
import { radius, spacing, withShadow } from '@/constants/styles';
import { formatLocalized } from '@/utils/dateLocale';

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
    const { t } = useTranslation();

    const renderStars = (rating: number) => {
        const fullStars = Math.floor(rating);
        const halfStar = rating % 1 >= 0.5;
        const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);

        return (
            <View style={styles.starsContainer}>
                {[...Array(fullStars)].map((_, i) => (
                    <Ionicons key={`full-${i}`} name="star" size={16} color={colors.ratingStar} />
                ))}
                {halfStar && <Ionicons name="star-half" size={16} color={colors.ratingStar} />}
                {[...Array(emptyStars)].map((_, i) => (
                    <Ionicons key={`empty-${i}`} name="star-outline" size={16} color={colors.ratingStar} />
                ))}
            </View>
        );
    };

    const handleHelpful = () => {
        if (onHelpful) {
            onHelpful(review._id);
        } else {
            Alert.alert(
                t('reviews.card.alertThankYouTitle'),
                t('reviews.card.alertThankYouBody'),
            );
        }
    };

    const handleReport = () => {
        if (onReport) {
            onReport(review._id);
        } else {
            Alert.alert(
                t('reviews.card.alertReportTitle'),
                t('reviews.card.alertReportBody'),
                [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                        text: t('reviews.card.alertReportConfirm'),
                        style: 'destructive',
                        onPress: () => {
                            Alert.alert(
                                t('reviews.card.alertReportedTitle'),
                                t('reviews.card.alertReportedBody'),
                            );
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
                t('reviews.card.alertReplyTitle'),
                t('reviews.card.alertReplyBody'),
                [{ text: t('common.ok') }]
            );
        }
    };

    const evidenceCount = review.evidenceCount || 1;
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
                                {review.isAnonymous
                                    ? t('reviews.card.anonymous')
                                    : t('reviews.card.verifiedResident')}
                            </ThemedText>

                            <View style={styles.trustIndicators}>
                                {review.verified && (
                                    <View style={styles.verifiedBadge}>
                                        <Ionicons name="checkmark-circle" size={14} color={colors.primaryColor} />
                                        <ThemedText style={styles.verifiedText}>
                                            {t('reviews.card.verified')}
                                        </ThemedText>
                                    </View>
                                )}

                                {!isCompact && (
                                    <View style={[styles.confidenceBadge, {
                                        backgroundColor: (review.confidenceScore || 0) >= 80 ? colors.success :
                                            (review.confidenceScore || 0) >= 60 ? colors.warning : colors.danger
                                    }]}>
                                        <ThemedText style={styles.confidenceText}>
                                            {t('reviews.card.confident', { score: review.confidenceScore || 0 })}
                                        </ThemedText>
                                    </View>
                                )}

                                {review.evidenceAttached && (
                                    <View style={styles.evidenceBadge}>
                                        <Ionicons name="document-attach" size={12} color={colors.COLOR_BLACK_LIGHT_3} />
                                        <ThemedText style={styles.evidenceText}>
                                            {evidenceCount}{' '}
                                            {evidenceCount > 1
                                                ? t('reviews.card.proofs')
                                                : t('reviews.card.proof')}
                                        </ThemedText>
                                    </View>
                                )}

                                {!isCompact && (review.karmaScore || 0) > 0 && (
                                    <View style={styles.karmaBadge}>
                                        <Ionicons name="trending-up" size={12} color={colors.info} />
                                        <ThemedText style={styles.karmaText}>
                                            {t('reviews.card.karma', { score: review.karmaScore || 0 })}
                                        </ThemedText>
                                    </View>
                                )}
                            </View>
                        </View>

                        <View style={styles.reviewMetaRow}>
                            <ThemedText style={styles.reviewDate}>
                                {formatLocalized(new Date(review.createdAt), 'PP')}
                            </ThemedText>
                            <ThemedText style={styles.livedDuration}>
                                {t('reviews.card.livedMonths', { count: review.livedForMonths })}
                            </ThemedText>
                            {review.price ? (
                                <ThemedText style={styles.price}>
                                    {t('reviews.card.perMonth', {
                                        price: review.price,
                                        currency: review.currency,
                                    })}
                                </ThemedText>
                            ) : null}
                        </View>

                        {!isCompact && review.flaggedIssues && review.flaggedIssues.length > 0 && (
                            <View style={styles.issueTagsContainer}>
                                {review.flaggedIssues.slice(0, 3).map((issue, index) => (
                                    <View key={index} style={styles.issueTag}>
                                        <ThemedText style={styles.issueTagText}>⚠️ {issue}</ThemedText>
                                    </View>
                                ))}
                                {review.flaggedIssues.length > 3 && (
                                    <View style={styles.issueTag}>
                                        <ThemedText style={styles.issueTagText}>
                                            {t('reviews.card.moreIssues', {
                                                count: review.flaggedIssues.length - 3,
                                            })}
                                        </ThemedText>
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
                    <ThemedText style={styles.commentLabel}>{t('reviews.card.positive')}</ThemedText>
                    <ThemedText style={styles.commentText}>{review.positiveComment}</ThemedText>
                </View>
            )}

            {!isCompact && review.negativeComment && (
                <View style={styles.commentSection}>
                    <ThemedText style={styles.commentLabel}>{t('reviews.card.negative')}</ThemedText>
                    <ThemedText style={styles.commentText}>{review.negativeComment}</ThemedText>
                </View>
            )}

            {showActions && (
                <View style={styles.reviewFooter}>
                    <View style={styles.moderationSection}>
                        <TouchableOpacity
                            style={[styles.helpfulButton, {
                                backgroundColor: (review.helpfulVotes || 0) > 0 ? colors.successSubtle : colors.surface,
                                borderColor: (review.helpfulVotes || 0) > 0 ? colors.success : colors.border
                            }]}
                            onPress={handleHelpful}
                        >
                            <Ionicons
                                name="thumbs-up"
                                size={18}
                                color={(review.helpfulVotes || 0) > 0 ? colors.success : colors.COLOR_BLACK_LIGHT_4}
                            />
                            <ThemedText style={[styles.helpfulText, {
                                color: (review.helpfulVotes || 0) > 0 ? colors.success : colors.COLOR_BLACK_LIGHT_4
                            }]}>
                                {t('reviews.card.helpful', { count: review.helpfulVotes || 0 })}
                            </ThemedText>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.helpfulButton, {
                                backgroundColor: colors.surface,
                                borderColor: colors.border
                            }]}
                            onPress={handleReport}
                        >
                            <Ionicons name="flag" size={18} color={colors.error} />
                            <ThemedText style={[styles.helpfulText, { color: colors.error }]}>
                                {t('reviews.card.report')}
                            </ThemedText>
                        </TouchableOpacity>

                        {review.replyAllowed && (
                            <TouchableOpacity
                                style={[styles.helpfulButton, {
                                    backgroundColor: colors.primaryLight_2,
                                    borderColor: colors.primaryColor
                                }]}
                                onPress={handleReply}
                            >
                                <Ionicons name="chatbubble" size={18} color={colors.primaryColor} />
                                <ThemedText style={[styles.helpfulText, { color: colors.primaryColor }]}>
                                    {t('reviews.card.reply')}
                                </ThemedText>
                            </TouchableOpacity>
                        )}
                    </View>

                    <View style={styles.recommendationSection}>
                        <ThemedText style={styles.recommendationText}>
                            {review.recommendation
                                ? t('reviews.card.recommends')
                                : t('reviews.card.doesNotRecommend')}
                        </ThemedText>

                        {review.moderationStatus === 'flagged' && (
                            <View style={styles.flaggedIndicator}>
                                <Ionicons name="warning" size={12} color={colors.warning} />
                                <ThemedText style={styles.flaggedText}>
                                    {t('reviews.card.underReview')}
                                </ThemedText>
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
        backgroundColor: colors.surfaceElevated,
        borderRadius: radius.lg,
        padding: spacing.xl,
        marginBottom: spacing.lg,
        ...withShadow('sm'),
    },
    compactCard: {
        padding: spacing.lg,
        marginBottom: spacing.md,
        borderRadius: radius.md,
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
        backgroundColor: colors.successSubtle,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 12,
        gap: 4,
        borderWidth: 1,
        borderColor: colors.success,
    },
    verifiedText: {
        fontSize: 11,
        color: colors.success,
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
        color: colors.white,
        fontWeight: '700',
    },
    evidenceBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.mutedSubtle,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 12,
        gap: 4,
        borderWidth: 1,
        borderColor: colors.border,
    },
    evidenceText: {
        fontSize: 11,
        color: colors.muted,
        fontWeight: '600',
    },
    karmaBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.infoSubtle,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 12,
        gap: 4,
        borderWidth: 1,
        borderColor: colors.info,
    },
    karmaText: {
        fontSize: 11,
        color: colors.info,
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
        backgroundColor: colors.warningSubtle,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.warning,
    },
    issueTagText: {
        fontSize: 12,
        color: colors.warning,
        fontWeight: '600',
    },
    starsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: colors.warningSubtle,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.ratingStar,
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
        backgroundColor: colors.surface,
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
        borderTopColor: colors.border,
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
        backgroundColor: colors.warningSubtle,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 10,
        gap: 4,
        marginTop: 6,
        borderWidth: 1,
        borderColor: colors.warning,
    },
    flaggedText: {
        fontSize: 11,
        color: colors.warning,
        fontWeight: '600',
    },
});

export default ReviewCard;
