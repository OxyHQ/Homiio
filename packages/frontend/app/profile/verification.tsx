import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '@/components/Header';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { VerificationBadge, VerificationLevel } from '@/components/VerificationBadge';
import { TrustScore } from '@/components/TrustScore';

type VerificationMethod = {
    id: string;
    title: string;
    description: string;
    icon: string;
    completed: boolean;
    required: boolean;
    tier: 'basic' | 'enhanced' | 'premium';
};

export default function VerificationScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const [currentLevel, setCurrentLevel] = useState<VerificationLevel>('basic');
    const [trustScore, setTrustScore] = useState(75);
    const [loading, setLoading] = useState(false);

    // Sample verification methods
    const verificationMethods: VerificationMethod[] = [
        {
            id: 'email',
            title: 'Email Verification',
            description: 'Verify your email address',
            icon: 'mail-outline',
            completed: true,
            required: true,
            tier: 'basic',
        },
        {
            id: 'phone',
            title: 'Phone Verification',
            description: 'Verify your phone number',
            icon: 'call-outline',
            completed: true,
            required: true,
            tier: 'basic',
        },
        {
            id: 'id',
            title: 'ID Verification',
            description: 'Upload a government-issued ID',
            icon: 'card-outline',
            completed: false,
            required: true,
            tier: 'enhanced',
        },
        {
            id: 'address',
            title: 'Address Verification',
            description: 'Confirm your current address',
            icon: 'home-outline',
            completed: false,
            required: true,
            tier: 'enhanced',
        },
        {
            id: 'background',
            title: 'Background Check',
            description: 'Complete a basic background verification',
            icon: 'shield-checkmark-outline',
            completed: false,
            required: true,
            tier: 'premium',
        },
        {
            id: 'income',
            title: 'Income Verification',
            description: 'Verify your source of income',
            icon: 'cash-outline',
            completed: false,
            required: true,
            tier: 'premium',
        },
        {
            id: 'social',
            title: 'Social Media',
            description: 'Link your social media accounts',
            icon: 'people-outline',
            completed: false,
            required: false,
            tier: 'basic',
        },
    ];

    const handleVerificationPress = (methodId: string) => {
        const method = verificationMethods.find(m => m.id === methodId);
        if (!method) return;

        if (method.completed) {
            // For completed methods, show details
            router.push(`/profile/verification/${methodId}`);
        } else {
            // For incomplete methods, start verification process
            router.push(`/profile/verification/${methodId}/start`);
        }
    };

    const getNextLevel = (): VerificationLevel => {
        switch (currentLevel) {
            case 'unverified':
                return 'basic';
            case 'basic':
                return 'enhanced';
            case 'enhanced':
                return 'premium';
            default:
                return 'premium';
        }
    };

    const getCompletedForLevel = (level: VerificationLevel): number => {
        if (level === 'unverified') return 0;

        const methodsForLevel = verificationMethods.filter(m => {
            if (level === 'basic') return m.tier === 'basic';
            if (level === 'enhanced') return m.tier === 'basic' || m.tier === 'enhanced';
            return true; // premium includes all
        });

        const completed = methodsForLevel.filter(m => m.completed);
        return completed.length;
    };

    const getTotalForLevel = (level: VerificationLevel): number => {
        if (level === 'unverified') return 0;

        const methodsForLevel = verificationMethods.filter(m => {
            if (level === 'basic') return m.tier === 'basic' && m.required;
            if (level === 'enhanced') return (m.tier === 'basic' || m.tier === 'enhanced') && m.required;
            return m.required; // premium includes all required
        });

        return methodsForLevel.length;
    };

    const renderVerificationItem = (method: VerificationMethod) => (
        <TouchableOpacity
            key={method.id}
            style={[
                styles.verificationItem,
                method.completed ? styles.verificationItemCompleted : {}
            ]}
            onPress={() => handleVerificationPress(method.id)}
        >
            <View style={styles.verificationIconContainer}>
                <Ionicons
                    name={method.icon as any}
                    size={24}
                    color={method.completed ? colors.primaryColor : colors.primaryDark_1}
                />
            </View>
            <View style={styles.verificationInfo}>
                <View style={styles.verificationHeader}>
                    <Text style={styles.verificationTitle}>{method.title}</Text>
                    {method.completed ? (
                        <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
                    ) : method.required ? (
                        <Text style={styles.requiredText}>Required</Text>
                    ) : (
                        <Text style={styles.optionalText}>Optional</Text>
                    )}
                </View>
                <Text style={styles.verificationDescription}>{method.description}</Text>
                <View style={styles.tierBadge}>
                    <Text style={styles.tierText}>
                        {method.tier === 'basic' ? 'Basic' : method.tier === 'enhanced' ? 'Enhanced' : 'Premium'}
                    </Text>
                </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.primaryDark_1} />
        </TouchableOpacity>
    );

    const nextLevel = getNextLevel();
    const basicCompleted = getCompletedForLevel('basic');
    const basicTotal = getTotalForLevel('basic');
    const enhancedCompleted = getCompletedForLevel('enhanced');
    const enhancedTotal = getTotalForLevel('enhanced');
    const premiumCompleted = getCompletedForLevel('premium');
    const premiumTotal = getTotalForLevel('premium');

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <Header
                options={{
                    showBackButton: true,
                    title: t("Verification"),
                    titlePosition: 'center',
                }}
            />

            <ScrollView style={styles.scrollView}>
                <View style={styles.profileSection}>
                    <View style={styles.trustScoreContainer}>
                        <TrustScore score={trustScore} size="large" />
                    </View>
                    <View style={styles.currentVerificationContainer}>
                        <Text style={styles.sectionTitle}>{t("Current Verification")}</Text>
                        <VerificationBadge level={currentLevel} size="large" />
                        <Text style={styles.verificationExplanation}>
                            {currentLevel === 'unverified'
                                ? t("You are not verified. Complete the basic verification steps to increase your trust score.")
                                : currentLevel === 'basic'
                                    ? t("You have completed basic verification. Enhance your profile with additional verification.")
                                    : currentLevel === 'enhanced'
                                        ? t("You have enhanced verification. Complete premium verification for maximum trust.")
                                        : t("You have premium verification. Your profile has maximum trust level.")}
                        </Text>
                    </View>
                </View>

                <View style={styles.progressSection}>
                    <Text style={styles.sectionTitle}>{t("Verification Progress")}</Text>

                    <View style={styles.progressItem}>
                        <View style={styles.progressHeader}>
                            <VerificationBadge level="basic" size="small" />
                            <Text style={styles.progressCount}>{basicCompleted}/{basicTotal}</Text>
                        </View>
                        <View style={styles.progressBar}>
                            <View
                                style={[
                                    styles.progressFill,
                                    { width: `${(basicCompleted / basicTotal) * 100}%`, backgroundColor: '#4CAF50' }
                                ]}
                            />
                        </View>
                    </View>

                    <View style={styles.progressItem}>
                        <View style={styles.progressHeader}>
                            <VerificationBadge level="enhanced" size="small" />
                            <Text style={styles.progressCount}>{enhancedCompleted}/{enhancedTotal}</Text>
                        </View>
                        <View style={styles.progressBar}>
                            <View
                                style={[
                                    styles.progressFill,
                                    { width: `${(enhancedCompleted / enhancedTotal) * 100}%`, backgroundColor: '#2196F3' }
                                ]}
                            />
                        </View>
                    </View>

                    <View style={styles.progressItem}>
                        <View style={styles.progressHeader}>
                            <VerificationBadge level="premium" size="small" />
                            <Text style={styles.progressCount}>{premiumCompleted}/{premiumTotal}</Text>
                        </View>
                        <View style={styles.progressBar}>
                            <View
                                style={[
                                    styles.progressFill,
                                    { width: `${(premiumCompleted / premiumTotal) * 100}%`, backgroundColor: '#673AB7' }
                                ]}
                            />
                        </View>
                    </View>
                </View>

                <View style={styles.verificationList}>
                    <Text style={styles.sectionTitle}>{t("Verification Methods")}</Text>
                    {verificationMethods.map(method => renderVerificationItem(method))}
                </View>

                <View style={styles.benefitsSection}>
                    <Text style={styles.sectionTitle}>{t("Verification Benefits")}</Text>
                    <View style={styles.benefitItem}>
                        <Ionicons name="shield-checkmark-outline" size={24} color={colors.primaryColor} />
                        <View style={styles.benefitContent}>
                            <Text style={styles.benefitTitle}>{t("Increased Trust")}</Text>
                            <Text style={styles.benefitDescription}>
                                {t("Higher verification levels increase your trust score, making it easier to get rental approvals.")}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.benefitItem}>
                        <Ionicons name="star-outline" size={24} color={colors.primaryColor} />
                        <View style={styles.benefitContent}>
                            <Text style={styles.benefitTitle}>{t("Priority Access")}</Text>
                            <Text style={styles.benefitDescription}>
                                {t("Verified users get priority access to premium listings and special offers.")}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.benefitItem}>
                        <Ionicons name="flash-outline" size={24} color={colors.primaryColor} />
                        <View style={styles.benefitContent}>
                            <Text style={styles.benefitTitle}>{t("Faster Approvals")}</Text>
                            <Text style={styles.benefitDescription}>
                                {t("Premium verified users often experience expedited rental application approvals.")}
                            </Text>
                        </View>
                    </View>
                </View>
            </ScrollView>

            <View style={styles.bottomButtonContainer}>
                <TouchableOpacity
                    style={[
                        styles.upgradeButton,
                        currentLevel === 'premium' && styles.disabledButton
                    ]}
                    disabled={currentLevel === 'premium'}
                    onPress={() => {
                        setLoading(true);
                        // Simulate upgrading process
                        setTimeout(() => {
                            if (currentLevel === 'unverified') setCurrentLevel('basic');
                            else if (currentLevel === 'basic') setCurrentLevel('enhanced');
                            else if (currentLevel === 'enhanced') setCurrentLevel('premium');
                            setLoading(false);
                        }, 1500);
                    }}
                >
                    {loading ? (
                        <ActivityIndicator color="white" />
                    ) : (
                        <>
                            <Ionicons name="shield-checkmark" size={20} color="white" />
                            <Text style={styles.upgradeButtonText}>
                                {currentLevel === 'premium'
                                    ? t("Maximum Level Reached")
                                    : t(`Upgrade to ${nextLevel} Verification`)}
                            </Text>
                        </>
                    )}
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.primaryLight,
    },
    scrollView: {
        flex: 1,
    },
    profileSection: {
        padding: 16,
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_5,
    },
    trustScoreContainer: {
        marginBottom: 16,
    },
    currentVerificationContainer: {
        alignItems: 'center',
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 12,
    },
    verificationExplanation: {
        textAlign: 'center',
        marginTop: 12,
        fontSize: 14,
        color: colors.primaryDark_1,
        paddingHorizontal: 20,
    },
    progressSection: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_5,
    },
    progressItem: {
        marginBottom: 16,
    },
    progressHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    progressCount: {
        fontSize: 14,
        color: colors.primaryDark,
        fontWeight: '500',
    },
    progressBar: {
        height: 8,
        backgroundColor: colors.COLOR_BLACK_LIGHT_5,
        borderRadius: 4,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 4,
    },
    verificationList: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_5,
    },
    verificationItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: 'white',
        borderRadius: 12,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
    },
    verificationItemCompleted: {
        borderColor: '#4CAF50',
        backgroundColor: 'rgba(76, 175, 80, 0.05)',
    },
    verificationIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.COLOR_BLACK_LIGHT_5,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    verificationInfo: {
        flex: 1,
    },
    verificationHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    verificationTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    requiredText: {
        fontSize: 12,
        color: '#F44336',
        fontWeight: '500',
    },
    optionalText: {
        fontSize: 12,
        color: colors.primaryDark_1,
    },
    verificationDescription: {
        fontSize: 14,
        color: colors.primaryDark_1,
        marginBottom: 6,
    },
    tierBadge: {
        backgroundColor: colors.COLOR_BLACK_LIGHT_5,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
        alignSelf: 'flex-start',
    },
    tierText: {
        fontSize: 10,
        color: colors.primaryDark,
    },
    benefitsSection: {
        padding: 16,
    },
    benefitItem: {
        flexDirection: 'row',
        marginBottom: 16,
    },
    benefitContent: {
        flex: 1,
        marginLeft: 12,
    },
    benefitTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 4,
    },
    benefitDescription: {
        fontSize: 14,
        color: colors.primaryDark_1,
        lineHeight: 20,
    },
    bottomButtonContainer: {
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: colors.COLOR_BLACK_LIGHT_5,
    },
    upgradeButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 12,
        borderRadius: 24,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    disabledButton: {
        backgroundColor: colors.COLOR_BLACK_LIGHT_3,
    },
    upgradeButtonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 16,
        marginLeft: 8,
    },
}); 