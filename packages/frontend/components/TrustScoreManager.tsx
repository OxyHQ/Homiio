import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { colors } from '@/styles/colors';
import { useTrustScore } from '@/hooks/useTrustScore';
import { useActiveProfile } from '@/hooks/useProfileQueries';
import { TrustScore } from './TrustScore';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export function TrustScoreManager() {
    const { data: activeProfile } = useActiveProfile();
    const currentProfileId = activeProfile?.id || activeProfile?._id;
    const router = useRouter();

    const {
        trustScoreData,
        loading: isLoading,
        error,
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

    if (isLoading) {
        return (
            <View style={styles.container}>
                <Text style={styles.loadingText}>Loading trust score...</Text>
            </View>
        );
    }

    if (error) {
        return (
            <View style={styles.container}>
                <Text style={styles.errorText}>Error loading trust score</Text>
            </View>
        );
    }

    if (!trustScoreData || trustScoreData.type !== 'personal') {
        return (
            <View style={styles.container}>
                <Text style={styles.errorText}>No personal trust score data found</Text>
            </View>
        );
    }

    const factors = trustScoreData.factors;

    const getFactorLabel = (factorType: string) => {
        const labels: Record<string, string> = {
            verification: 'Identity Verification',
            reviews: 'User Reviews',
            payment_history: 'Payment History',
            communication: 'Communication',
            rental_history: 'Rental History'
        };
        return labels[factorType] || factorType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
    };

    const getFactorDescription = (factorType: string) => {
        const descriptions: Record<string, string> = {
            verification: 'Complete identity verification to build trust',
            reviews: 'Get positive reviews from landlords and roommates',
            payment_history: 'Maintain a good payment history',
            communication: 'Respond promptly to messages and requests',
            rental_history: 'Build a positive rental history'
        };
        return descriptions[factorType] || 'Improve this factor to increase your trust score';
    };

    const getFactorActionText = (factorType: string) => {
        const actions: Record<string, string> = {
            verification: 'Add personal information and income details',
            reviews: 'Add references from previous landlords',
            payment_history: 'Add rental history with payment records',
            communication: 'Complete your profile bio and contact info',
            rental_history: 'Add your previous rental addresses'
        };
        return actions[factorType] || 'Complete your profile to improve this factor';
    };

    const handleEditProfile = (section?: string) => {
        if (section) {
            // Navigate to specific section if provided
            router.push(`/profile/edit?section=${section}`);
        } else {
            router.push('/profile/edit');
        }
    };

    const getProfileSection = (factorType: string) => {
        const sections: Record<string, string> = {
            verification: 'personal',
            reviews: 'references', 
            payment_history: 'rental-history',
            communication: 'personal',
            rental_history: 'rental-history'
        };
        return sections[factorType] || 'personal';
    };

    const showFactorDetails = (factorType: string) => {
        const factor = factors.find(f => f.type === factorType);
        if (!factor) return;

        const section = getProfileSection(factorType);
        const actionText = getFactorActionText(factorType);

        Alert.alert(
            getFactorLabel(factorType),
            `${getFactorDescription(factorType)}\n\nCurrent Score: ${factor.value}/100\n\nTo improve: ${actionText}`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Edit Profile',
                    onPress: () => handleEditProfile(section)
                }
            ]
        );
    };

    return (
        <ScrollView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Trust Score</Text>
                <Text style={styles.subtitle}>
                    Build trust with landlords and roommates
                </Text>
            </View>

            <View style={styles.scoreSection}>
                <TrustScore
                    score={trustScoreData.score}
                    size="large"
                    showLabel={true}
                />
                <Text style={styles.scoreDescription}>
                    Your overall trust score is {trustScoreData.score}/100
                </Text>
            </View>

            <View style={styles.factorsSection}>
                <Text style={styles.sectionTitle}>Trust Factors</Text>
                <Text style={styles.sectionSubtitle}>
                    Improve these factors to increase your trust score
                </Text>

                {factors.map((factor, index) => (
                    <TouchableOpacity
                        key={index}
                        style={styles.factorCard}
                        onPress={() => showFactorDetails(factor.type)}
                    >
                        <View style={styles.factorHeader}>
                            <Text style={styles.factorTitle}>
                                {getFactorLabel(factor.type)}
                            </Text>
                            <Text style={styles.factorScore}>
                                {factor.value}/100
                            </Text>
                        </View>

                        <View style={styles.progressBar}>
                            <View
                                style={[
                                    styles.progressFill,
                                    {
                                        width: `${factor.value}%`,
                                        backgroundColor: factor.value >= 70 ? colors.online :
                                            factor.value >= 50 ? colors.away : colors.busy
                                    }
                                ]}
                            />
                        </View>

                        <Text style={styles.factorDescription}>
                            {getFactorDescription(factor.type)}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <View style={styles.tipsSection}>
                <Text style={styles.sectionTitle}>Quick Actions to Improve Score</Text>
                
                <TouchableOpacity 
                    style={styles.actionCard}
                    onPress={() => handleEditProfile('personal')}
                >
                    <View style={styles.actionCardHeader}>
                        <Ionicons name="person-outline" size={24} color={colors.primaryColor} />
                        <Text style={styles.actionCardTitle}>Complete Personal Info</Text>
                        <Ionicons name="chevron-forward" size={20} color={colors.COLOR_BLACK_LIGHT_5} />
                    </View>
                    <Text style={styles.actionCardText}>
                        Add your occupation, income, and employment details to build trust.
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity 
                    style={styles.actionCard}
                    onPress={() => handleEditProfile('references')}
                >
                    <View style={styles.actionCardHeader}>
                        <Ionicons name="people-outline" size={24} color={colors.primaryColor} />
                        <Text style={styles.actionCardTitle}>Add References</Text>
                        <Ionicons name="chevron-forward" size={20} color={colors.COLOR_BLACK_LIGHT_5} />
                    </View>
                    <Text style={styles.actionCardText}>
                        Include references from previous landlords and employers.
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity 
                    style={styles.actionCard}
                    onPress={() => handleEditProfile('rental-history')}
                >
                    <View style={styles.actionCardHeader}>
                        <Ionicons name="home-outline" size={24} color={colors.primaryColor} />
                        <Text style={styles.actionCardTitle}>Add Rental History</Text>
                        <Ionicons name="chevron-forward" size={20} color={colors.COLOR_BLACK_LIGHT_5} />
                    </View>
                    <Text style={styles.actionCardText}>
                        Document your rental history to show your reliability as a tenant.
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity 
                    style={styles.primaryActionButton}
                    onPress={() => handleEditProfile()}
                >
                    <Ionicons name="create-outline" size={20} color={colors.primaryLight} />
                    <Text style={styles.primaryActionButtonText}>Complete Profile</Text>
                </TouchableOpacity>
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
    scoreDescription: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_5,
        marginTop: 12,
        textAlign: 'center',
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
    factorScore: {
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
    tipsSection: {
        padding: 20,
    },
    actionCard: {
        backgroundColor: colors.primaryLight,
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
        borderLeftWidth: 4,
        borderLeftColor: colors.primaryColor,
    },
    actionCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
        gap: 12,
    },
    actionCardTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
        flex: 1,
    },
    actionCardText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
        lineHeight: 20,
        marginLeft: 36,
    },
    primaryActionButton: {
        backgroundColor: colors.primaryColor,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        borderRadius: 12,
        marginTop: 8,
        gap: 8,
    },
    primaryActionButtonText: {
        color: colors.primaryLight,
        fontSize: 16,
        fontWeight: 'bold',
        fontFamily: 'Phudu',
    },
    tipCard: {
        backgroundColor: colors.primaryLight_1,
        padding: 16,
        borderRadius: 8,
        marginBottom: 12,
        borderLeftWidth: 4,
        borderLeftColor: colors.primaryColor,
    },
    tipTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
        marginBottom: 4,
    },
    tipText: {
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