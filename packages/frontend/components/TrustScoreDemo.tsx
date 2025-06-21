import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { colors } from '@/styles/colors';
import { usePrimaryProfile, useUpdateTrustScore } from '@/hooks/useProfileQueries';
import { TrustScore } from './TrustScore';

export function TrustScoreDemo() {
    const { data: profile, isLoading, error, refetch } = usePrimaryProfile();
    const updateTrustScore = useUpdateTrustScore();
    const [isUpdating, setIsUpdating] = useState(false);

    const demoFactors = [
        { type: 'verification', label: 'Identity Verification', description: 'Complete identity verification' },
        { type: 'reviews', label: 'User Reviews', description: 'Get positive reviews from landlords' },
        { type: 'payment_history', label: 'Payment History', description: 'Maintain good payment history' },
        { type: 'communication', label: 'Communication', description: 'Respond promptly to messages' },
        { type: 'rental_history', label: 'Rental History', description: 'Build positive rental history' },
    ];

    const handleDemoUpdate = async (factorType: string) => {
        if (!profile?.id) {
            Alert.alert('Error', 'No profile found');
            return;
        }

        setIsUpdating(true);
        try {
            // Get current factor value
            const currentFactor = profile.personalProfile?.trustScore.factors.find(f => f.type === factorType);
            const currentValue = currentFactor?.value || 0;
            const newValue = Math.min(currentValue + 15, 100);

            await updateTrustScore.mutateAsync({
                profileId: profile.id,
                factor: factorType,
                value: newValue
            });

            Alert.alert(
                'Demo Update Success',
                `${demoFactors.find(f => f.type === factorType)?.label} updated from ${currentValue} to ${newValue}`
            );

            // Refetch the profile to show updated data
            refetch();
        } catch (error) {
            Alert.alert('Demo Update Error', 'Failed to update trust score');
        } finally {
            setIsUpdating(false);
        }
    };

    const handleResetDemo = async () => {
        if (!profile?.id) {
            Alert.alert('Error', 'No profile found');
            return;
        }

        setIsUpdating(true);
        try {
            // Reset all factors to 50
            const resetPromises = demoFactors.map(factor =>
                updateTrustScore.mutateAsync({
                    profileId: profile.id,
                    factor: factor.type,
                    value: 50
                })
            );

            await Promise.all(resetPromises);
            Alert.alert('Demo Reset', 'All trust factors reset to 50');
            refetch();
        } catch (error) {
            Alert.alert('Demo Reset Error', 'Failed to reset trust score');
        } finally {
            setIsUpdating(false);
        }
    };

    if (isLoading) {
        return (
            <View style={styles.container}>
                <Text style={styles.loadingText}>Loading profile data...</Text>
            </View>
        );
    }

    if (error) {
        return (
            <View style={styles.container}>
                <Text style={styles.errorText}>Error loading profile: {error.message}</Text>
            </View>
        );
    }

    if (!profile?.personalProfile) {
        return (
            <View style={styles.container}>
                <Text style={styles.errorText}>No personal profile found</Text>
            </View>
        );
    }

    const { trustScore } = profile.personalProfile;

    return (
        <ScrollView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Trust Score API Demo</Text>
                <Text style={styles.subtitle}>
                    This demo shows how the trust score API integration works
                </Text>
            </View>

            <View style={styles.scoreSection}>
                <TrustScore score={trustScore.score} size="large" showLabel={true} />
                <Text style={styles.scoreText}>
                    Current Score: {trustScore.score}/100
                </Text>
            </View>

            <View style={styles.factorsSection}>
                <Text style={styles.sectionTitle}>Trust Factors</Text>
                <Text style={styles.sectionSubtitle}>
                    Tap any factor to increase it by 15 points (demo)
                </Text>

                {demoFactors.map((demoFactor, index) => {
                    const factor = trustScore.factors.find(f => f.type === demoFactor.type);
                    const value = factor?.value || 0;

                    return (
                        <TouchableOpacity
                            key={index}
                            style={styles.factorCard}
                            onPress={() => handleDemoUpdate(demoFactor.type)}
                            disabled={isUpdating}
                        >
                            <View style={styles.factorHeader}>
                                <Text style={styles.factorTitle}>{demoFactor.label}</Text>
                                <Text style={styles.factorValue}>{value}/100</Text>
                            </View>

                            <View style={styles.progressBar}>
                                <View
                                    style={[
                                        styles.progressFill,
                                        {
                                            width: `${value}%`,
                                            backgroundColor: value >= 70 ? colors.online :
                                                value >= 50 ? colors.away : colors.busy
                                        }
                                    ]}
                                />
                            </View>

                            <Text style={styles.factorDescription}>
                                {demoFactor.description}
                            </Text>

                            {factor && (
                                <Text style={styles.lastUpdated}>
                                    Last updated: {new Date(factor.updatedAt).toLocaleString()}
                                </Text>
                            )}
                        </TouchableOpacity>
                    );
                })}
            </View>

            <View style={styles.actionsSection}>
                <TouchableOpacity
                    style={styles.resetButton}
                    onPress={handleResetDemo}
                    disabled={isUpdating}
                >
                    <Text style={styles.resetButtonText}>
                        {isUpdating ? 'Resetting...' : 'Reset All to 50 (Demo)'}
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.refreshButton}
                    onPress={() => refetch()}
                    disabled={isUpdating}
                >
                    <Text style={styles.refreshButtonText}>
                        Refresh Data
                    </Text>
                </TouchableOpacity>
            </View>

            <View style={styles.infoSection}>
                <Text style={styles.infoTitle}>API Integration Details</Text>
                <Text style={styles.infoText}>
                    • Uses React Query for data fetching and caching{'\n'}
                    • Automatic cache invalidation on updates{'\n'}
                    • Optimistic updates for better UX{'\n'}
                    • Error handling and loading states{'\n'}
                    • Real-time data synchronization
                </Text>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    },
    header: {
        padding: 20,
        alignItems: 'center',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: colors.COLOR_BLACK,
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_5,
        textAlign: 'center',
    },
    scoreSection: {
        alignItems: 'center',
        padding: 20,
        backgroundColor: colors.primaryLight,
        margin: 20,
        borderRadius: 12,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    scoreText: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.COLOR_BLACK,
        marginTop: 12,
    },
    factorsSection: {
        padding: 20,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: colors.COLOR_BLACK,
        marginBottom: 8,
    },
    sectionSubtitle: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginBottom: 16,
    },
    factorCard: {
        backgroundColor: colors.primaryLight,
        padding: 16,
        borderRadius: 8,
        marginBottom: 12,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    factorHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    factorTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
        flex: 1,
    },
    factorValue: {
        fontSize: 16,
        fontWeight: 'bold',
        color: colors.primaryColor,
    },
    progressBar: {
        height: 6,
        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
        borderRadius: 3,
        marginBottom: 8,
    },
    progressFill: {
        height: '100%',
        borderRadius: 3,
    },
    factorDescription: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginBottom: 4,
    },
    lastUpdated: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_5,
        fontStyle: 'italic',
    },
    actionsSection: {
        padding: 20,
        gap: 12,
    },
    resetButton: {
        backgroundColor: colors.busy,
        padding: 16,
        borderRadius: 8,
        alignItems: 'center',
    },
    resetButtonText: {
        color: colors.primaryLight,
        fontSize: 16,
        fontWeight: '600',
    },
    refreshButton: {
        backgroundColor: colors.primaryColor,
        padding: 16,
        borderRadius: 8,
        alignItems: 'center',
    },
    refreshButtonText: {
        color: colors.primaryLight,
        fontSize: 16,
        fontWeight: '600',
    },
    infoSection: {
        padding: 20,
        backgroundColor: colors.primaryLight_1,
        margin: 20,
        borderRadius: 8,
    },
    infoTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.COLOR_BLACK,
        marginBottom: 12,
    },
    infoText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_5,
        lineHeight: 20,
    },
    loadingText: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_5,
        textAlign: 'center',
        marginTop: 50,
    },
    errorText: {
        fontSize: 16,
        color: colors.busy,
        textAlign: 'center',
        marginTop: 50,
    },
}); 