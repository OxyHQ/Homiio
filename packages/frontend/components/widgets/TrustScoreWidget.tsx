import React, { useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import LoadingSpinner from '../LoadingSpinner';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { useOxy } from '@oxyhq/services';
import { TrustScoreCompact } from '../TrustScoreCompact';
import { useTrustScore } from '@/hooks/useTrustScore';
import { useActiveProfile } from '@/hooks/useProfileQueries';
import { ThemedText } from '../ThemedText';

export function TrustScoreWidget() {
    const { t } = useTranslation();
    const { isAuthenticated } = useOxy();
    const router = useRouter();
    const { data: activeProfile } = useActiveProfile();

    // Get the current profile ID
    const currentProfileId = activeProfile?.id || activeProfile?._id;

    const {
        trustScoreData,
        loading: isLoading,
        error,
        profileType,
        setCurrentProfileId,
        fetchTrustScoreData
    } = useTrustScore(currentProfileId);

    // Set the profile ID and fetch trust score when active profile changes
    useEffect(() => {
        if (currentProfileId) {
            setCurrentProfileId(currentProfileId);
            fetchTrustScoreData(currentProfileId);
        }
    }, [currentProfileId, setCurrentProfileId, fetchTrustScoreData]);

    const handlePress = useMemo(() => () => {
        if (profileType === 'agency') {
            router.push('/profile/edit');
        } else {
            router.push('/profile/trust-score');
        }
    }, [router, profileType]);

    // Helper function to get color based on score percentage
    const getScoreColor = (score: number) => {
        if (score >= 90) return '#4CAF50';
        if (score >= 70) return '#8BC34A';
        if (score >= 50) return '#FFC107';
        if (score >= 30) return '#FF9800';
        return '#F44336';
    };

    const renderContent = () => {
        if (isLoading) {
            return (
                <View style={styles.loadingContainer}>
                    <LoadingSpinner size={16} showText={false} />
                    <ThemedText style={styles.loadingText}>
                        {profileType === 'agency' ? t('trust.loadingVerification', 'Loading verification status...') : t('trust.loadingScore', 'Loading trust score...')}
                    </ThemedText>
                </View>
            );
        }

        if (error) {
            return (
                <View style={styles.errorContainer}>
                    <ThemedText style={styles.errorText}>
                        {profileType === 'agency' ? t('trust.errorVerification', 'Unable to load verification status') : t('trust.errorScore', 'Unable to load trust score')}
                    </ThemedText>
                    <TouchableOpacity
                        style={[styles.retryButton]}
                        onPress={handlePress}
                    >
                        <ThemedText style={styles.retryButtonText}>{t('trust.viewDetails', 'View Details')}</ThemedText>
                    </TouchableOpacity>
                </View>
            );
        }

        if (!trustScoreData) {
            return (
                <View style={styles.noProfileContainer}>
                    <Text style={styles.noProfileText}>
                        {profileType === 'agency' ? t('trust.noVerification', 'No verification data') : t('trust.noScore', 'No trust score data')}
                    </Text>
                    <TouchableOpacity
                        style={[styles.setupButton, { backgroundColor: colors.primaryColor }]}
                        onPress={handlePress}
                    >
                        <Text style={styles.setupButtonText}>{t('trust.viewDetails', 'View Details')}</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        if (trustScoreData.type === 'agency') {
            const scoreColor = getScoreColor(trustScoreData.score);
            return (
                <View style={styles.trustScoreContent}>
                    <View style={styles.verificationCircle}>
                        <ThemedText style={[styles.verificationPercentage, { color: scoreColor }]}>
                            {Math.round(trustScoreData.score)}%
                        </ThemedText>
                        <ThemedText style={styles.verificationLabel}>{t('trust.verified', 'Verified')}</ThemedText>
                    </View>

                    <ThemedText style={[styles.trustScoreText]}>
                        {trustScoreData.level}
                    </ThemedText>

                    <TouchableOpacity
                        style={[styles.improveButton, { backgroundColor: scoreColor }]}
                        onPress={handlePress}
                    >
                        <ThemedText style={styles.improveButtonText}>{t('trust.completeVerification', 'Complete Verification')}</ThemedText>
                    </TouchableOpacity>
                </View>
            );
        }

        // Personal profile rendering
        const scoreColor = getScoreColor(trustScoreData.score);
        return (
            <View style={styles.trustScoreContent}>
                <TrustScoreCompact
                    score={trustScoreData.score}
                    size="large"
                    showLabel={false}
                />

                <ThemedText style={[styles.trustScoreText]}>
                    {t('trust.yourScoreIs', 'Your trust score is')} {trustScoreData.level}
                </ThemedText>

                <View style={styles.factorsPreview}>
                    {trustScoreData.factors.map((factor, index) => (
                        <View key={index} style={styles.factorPreview}>
                            <ThemedText style={styles.factorLabel}>
                                {factor.type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </ThemedText>
                            <View style={styles.factorProgress}>
                                <View
                                    style={[
                                        styles.factorProgressFill,
                                        {
                                            width: `${factor.value}%`,
                                            backgroundColor: scoreColor
                                        }
                                    ]}
                                />
                            </View>
                        </View>
                    ))}
                </View>

                <TouchableOpacity
                    style={[styles.improveButton, { backgroundColor: scoreColor }]}
                    onPress={handlePress}
                >
                    <ThemedText style={styles.improveButtonText}>{t('trust.improveScore', 'Improve Score')}</ThemedText>
                </TouchableOpacity>
            </View>
        );
    };

    if (!isAuthenticated) {
        return null; // Don't show the widget if the user is not authenticated
    }

    return (
        <View style={styles.widgetContainer}>
            {/* Widget Content */}
            <View style={styles.widgetContent}>
                {renderContent()}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    widgetContainer: {
        backgroundColor: colors.primaryLight,
        borderRadius: 15,
        overflow: 'hidden',
    },
    widgetContent: {
        padding: 20,
    },
    trustScoreContent: {
        alignItems: 'center',
        padding: 10,
    },
    loadingContainer: {
        alignItems: 'center',
        padding: 20,
    },
    loadingText: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginTop: 8,
    },
    errorContainer: {
        alignItems: 'center',
        padding: 20,
    },
    errorText: {
        fontSize: 16,
        color: colors.busy,
        marginBottom: 12,
        textAlign: 'center',
    },
    retryButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 25,
    },
    retryButtonText: {
        color: colors.primaryLight,
        fontSize: 14,
        fontWeight: '600',
        fontFamily: 'Phudu',
    },
    noProfileContainer: {
        alignItems: 'center',
        padding: 20,
    },
    noProfileText: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginBottom: 12,
        textAlign: 'center',
    },
    setupButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 25,
    },
    setupButtonText: {
        color: colors.primaryLight,
        fontSize: 14,
        fontWeight: '600',
        fontFamily: 'Phudu',
    },
    trustScoreText: {
        fontSize: 18,
        fontWeight: '600',
        marginTop: 8,
        marginBottom: 12,
        textAlign: 'center',
    },
    factorsPreview: {
        width: '100%',
        marginBottom: 12,
    },
    factorPreview: {
        marginBottom: 6,
    },
    factorLabel: {
        fontSize: 10,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginBottom: 2,
    },
    factorProgress: {
        height: 3,
        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
        borderRadius: 2,
    },
    factorProgressFill: {
        height: '100%',
        borderRadius: 2,
    },
    improveButton: {
        backgroundColor: colors.primaryLight_1,
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 25,
        borderWidth: 0,
    },
    improveButtonText: {
        color: colors.primaryLight,
        fontSize: 14,
        fontWeight: 'bold',
        fontFamily: 'Phudu',
    },
    iconContainer: {
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconText: {
        fontSize: 12,
    },
    verificationCircle: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
        justifyContent: 'center',
        alignItems: 'center',
    },
    verificationPercentage: {
        fontSize: 24,
        fontWeight: 'bold',
        fontFamily: 'Phudu',
    },
    verificationLabel: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginTop: 4,
    },
    verificationList: {
        width: '100%',
        marginTop: 12,
        marginBottom: 12,
    },
    verificationListTitle: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginBottom: 4,
    },
    verificationItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    verificationItemText: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_5,
    },
    verificationItemStatus: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_5,
    },
}); 