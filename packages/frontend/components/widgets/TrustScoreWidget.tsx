import React, { useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';
import { useOxy } from '@oxyhq/services';
import { TrustScoreCompact } from '../TrustScoreCompact';
import { useTrustScore } from '@/hooks/useTrustScore';
import { useActiveProfile } from '@/hooks/useProfileQueries';

export function TrustScoreWidget() {
    const { isAuthenticated } = useOxy();
    const { t } = useTranslation();
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

    if (!isAuthenticated) {
        return null; // Don't show the widget if the user is not authenticated
    }

    const renderContent = () => {
        if (isLoading) {
            return (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color={colors.primaryColor} />
                    <Text style={styles.loadingText}>
                        Loading {profileType === 'agency' ? 'verification status' : 'trust score'}...
                    </Text>
                </View>
            );
        }

        if (error) {
            return (
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>
                        Unable to load {profileType === 'agency' ? 'verification status' : 'trust score'}
                    </Text>
                    <TouchableOpacity style={styles.retryButton} onPress={handlePress}>
                        <Text style={styles.retryButtonText}>View Details</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        if (!trustScoreData) {
            return (
                <View style={styles.noProfileContainer}>
                    <Text style={styles.noProfileText}>
                        No {profileType === 'agency' ? 'verification' : 'trust score'} data
                    </Text>
                    <TouchableOpacity style={styles.setupButton} onPress={handlePress}>
                        <Text style={styles.setupButtonText}>View Details</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        if (trustScoreData.type === 'agency') {
            return (
                <View style={styles.trustScoreContent}>
                    <View style={styles.verificationCircle}>
                        <Text style={[styles.verificationPercentage, { color: trustScoreData.color }]}>
                            {Math.round(trustScoreData.percentage)}%
                        </Text>
                        <Text style={styles.verificationLabel}>Verified</Text>
                    </View>

                    <Text style={[styles.trustScoreText, { color: trustScoreData.color }]}>
                        {trustScoreData.level}
                    </Text>

                    <View style={styles.verificationList}>
                        <Text style={styles.verificationListTitle}>Verification Status:</Text>
                        {Object.entries(trustScoreData.verifications).map(([key, value]) => (
                            <View key={key} style={styles.verificationItem}>
                                <Text style={styles.verificationItemText}>
                                    {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                                </Text>
                                <Text style={[
                                    styles.verificationItemStatus,
                                    { color: value ? colors.online : colors.busy }
                                ]}>
                                    {value ? '✓' : '○'}
                                </Text>
                            </View>
                        ))}
                    </View>

                    <TouchableOpacity style={styles.improveButton} onPress={handlePress}>
                        <Text style={styles.improveButtonText}>Complete Verification</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        // Personal profile rendering
        return (
            <View style={styles.trustScoreContent}>
                <TrustScoreCompact
                    score={trustScoreData.score}
                    size="large"
                    showLabel={false}
                />

                <Text style={[styles.trustScoreText, { color: trustScoreData.color }]}>
                    Your trust score is {trustScoreData.level}
                </Text>

                <View style={styles.factorsPreview}>
                    {trustScoreData.factors.map((factor, index) => (
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
                                            backgroundColor: trustScoreData.color
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
            title={profileType === 'agency' ? t("Business Verification") : t("Trust Score")}
            icon={
                <View style={[styles.iconContainer, { backgroundColor: colors.primaryColor }]}>
                    <Text style={styles.iconText}>
                        {profileType === 'agency' ? '🏢' : '🛡️'}
                    </Text>
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
        fontWeight: '600',
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