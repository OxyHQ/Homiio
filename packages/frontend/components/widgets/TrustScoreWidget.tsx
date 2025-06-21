import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';
import { useOxy } from '@oxyhq/services';
import { usePrimaryProfile } from '@/hooks/useProfileQueries';
import { TrustScore } from '../TrustScore';

export function TrustScoreWidget() {
    const { isAuthenticated } = useOxy();
    const { t } = useTranslation();
    const router = useRouter();
    const { data: profile, isLoading, error } = usePrimaryProfile();

    if (!isAuthenticated) {
        return null; // Don't show the widget if the user is not authenticated
    }

    const getTrustLevel = (score: number) => {
        if (score >= 90) return 'Excellent';
        if (score >= 70) return 'Good';
        if (score >= 50) return 'Average';
        if (score >= 30) return 'Fair';
        return 'Needs Improvement';
    };

    const getTrustColor = (score: number) => {
        if (score >= 90) return '#4CAF50';
        if (score >= 70) return '#8BC34A';
        if (score >= 50) return '#FFC107';
        if (score >= 30) return '#FF9800';
        return '#F44336';
    };

    const handlePress = () => {
        router.push('/profile/trust-score');
    };

    const renderContent = () => {
        if (isLoading) {
            return (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color={colors.primaryColor} />
                    <Text style={styles.loadingText}>Loading trust score...</Text>
                </View>
            );
        }

        if (error) {
            return (
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>Unable to load trust score</Text>
                    <TouchableOpacity style={styles.retryButton} onPress={() => router.push('/profile/trust-score')}>
                        <Text style={styles.retryButtonText}>View Details</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        if (!profile?.personalProfile) {
            return (
                <View style={styles.noProfileContainer}>
                    <Text style={styles.noProfileText}>No profile found</Text>
                    <TouchableOpacity style={styles.setupButton} onPress={() => router.push('/profile')}>
                        <Text style={styles.setupButtonText}>Setup Profile</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        const { trustScore } = profile.personalProfile;
        const trustLevel = getTrustLevel(trustScore.score);
        const trustColor = getTrustColor(trustScore.score);

        return (
            <View style={styles.trustScoreContent}>
                <TrustScore
                    score={trustScore.score}
                    size="large"
                    showLabel={false}
                />

                <Text style={[styles.trustScoreText, { color: trustColor }]}>
                    Your trust score is {trustLevel}
                </Text>

                <View style={styles.factorsPreview}>
                    {trustScore.factors.slice(0, 2).map((factor, index) => (
                        <View key={index} style={styles.factorPreview}>
                            <Text style={styles.factorLabel}>
                                {factor.type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </Text>
                            <View style={styles.factorProgress}>
                                <View
                                    style={[
                                        styles.factorProgressFill,
                                        {
                                            width: `${factor.value}%`,
                                            backgroundColor: trustColor
                                        }
                                    ]}
                                />
                            </View>
                        </View>
                    ))}
                </View>

                <TouchableOpacity style={styles.improveButton} onPress={handlePress}>
                    <Text style={styles.improveButtonText}>Improve Score</Text>
                </TouchableOpacity>
            </View>
        );
    };

    return (
        <BaseWidget
            title={t("Trust Score")}
            icon={
                <View style={[styles.iconContainer, { backgroundColor: colors.primaryColor }]}>
                    <Text style={styles.iconText}>🛡️</Text>
                </View>
            }
        >
            {renderContent()}
        </BaseWidget>
    );
}

const styles = StyleSheet.create({
    trustScoreContent: {
        alignItems: 'center',
        padding: 10,
    },
    loadingContainer: {
        alignItems: 'center',
        padding: 20,
    },
    loadingText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginTop: 8,
    },
    errorContainer: {
        alignItems: 'center',
        padding: 20,
    },
    errorText: {
        fontSize: 14,
        color: colors.busy,
        marginBottom: 12,
        textAlign: 'center',
    },
    retryButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 15,
    },
    retryButtonText: {
        color: colors.primaryLight,
        fontSize: 12,
        fontWeight: '600',
    },
    noProfileContainer: {
        alignItems: 'center',
        padding: 20,
    },
    noProfileText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginBottom: 12,
        textAlign: 'center',
    },
    setupButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 15,
    },
    setupButtonText: {
        color: colors.primaryLight,
        fontSize: 12,
        fontWeight: '600',
    },
    trustScoreText: {
        fontSize: 14,
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
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 15,
        borderWidth: 1,
        borderColor: colors.primaryColor,
    },
    improveButtonText: {
        color: colors.primaryColor,
        fontSize: 12,
        fontWeight: '600',
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
}); 