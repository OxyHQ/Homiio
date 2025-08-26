import React, { useState } from 'react';
import {
    View,
    StyleSheet,
    ScrollView,
    Alert,
    Linking,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { Header } from '@/components/Header';
import { ThemedText } from '@/components/ThemedText';
import { ActionButton } from '@/components/ui/ActionButton';
import { FilterChip } from '@/components/ui/FilterChip';
import { colors } from '@/styles/colors';
import { useOxy } from '@oxyhq/services';
import { api } from '@/utils/api';

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

type DonationTier = {
    id: string;
    title: string;
    description: string;
    amount: number;
    currency: string;
    type: 'one-time' | 'monthly' | 'founder';
    icon: string;
    benefits: string[];
    popular?: boolean;
};

export default function DonatePage() {
    const { t } = useTranslation();
    const _router = useRouter();
    const { oxyServices, activeSessionId } = useOxy();
    const [loading, setLoading] = useState(false);

    const donationTiers: DonationTier[] = [
        {
            id: 'one-time-5',
            title: t('donations.page.tiers.supporter.title'),
            description: t('donations.page.tiers.supporter.subtitle'),
            amount: 5,
            currency: '€',
            type: 'one-time',
            icon: 'heart',
            benefits: [
                t('donations.page.impact.areas.development.title'),
                t('donations.page.impact.areas.safety.title'),
                t('donations.page.impact.areas.community.title'),
            ],
        },
        {
            id: 'monthly-10',
            title: t('donations.page.tiers.monthly.title'),
            description: t('donations.page.tiers.monthly.subtitle'),
            amount: 10,
            currency: '€',
            type: 'monthly',
            icon: 'heart',
            popular: true,
            benefits: [
                t('donations.page.impact.areas.development.title'),
                t('donations.page.impact.areas.safety.title'),
                t('donations.page.impact.areas.legal.title'),
                t('donations.page.impact.areas.innovation.title'),
            ],
        },
        {
            id: 'founder-25',
            title: t('donations.page.tiers.founder.title'),
            description: t('donations.page.tiers.founder.subtitle'),
            amount: 25,
            currency: '€',
            type: 'founder',
            icon: 'star',
            benefits: [
                t('donations.page.impact.areas.development.title'),
                t('donations.page.impact.areas.safety.title'),
                t('donations.page.impact.areas.legal.title'),
                t('donations.page.impact.areas.innovation.title'),
                t('donations.page.impact.areas.community.title'),
            ],
        },
    ];

    const impactAreas = [
        {
            icon: 'construct',
            title: t('donations.page.impact.areas.development.title'),
            description: t('donations.page.impact.areas.development.description'),
        },
        {
            icon: 'shield-checkmark',
            title: t('donations.page.impact.areas.safety.title'),
            description: t('donations.page.impact.areas.safety.description'),
        },
        {
            icon: 'document-text',
            title: t('donations.page.impact.areas.legal.title'),
            description: t('donations.page.impact.areas.legal.description'),
        },
        {
            icon: 'bulb',
            title: t('donations.page.impact.areas.innovation.title'),
            description: t('donations.page.impact.areas.innovation.description'),
        },
        {
            icon: 'people',
            title: t('donations.page.impact.areas.community.title'),
            description: t('donations.page.impact.areas.community.description'),
        },
    ];

    const handleDonation = async (tier: DonationTier) => {
        try {
            setLoading(true);

            // Map tier types to billing products
            const productMap = {
                'one-time': 'file', // Using existing file product for one-time payments
                'monthly': 'plus', // Using existing plus product for monthly
                'founder': 'founder', // Using existing founder product
            };

            const product = productMap[tier.type];

            const response = await api.post('/api/billing/create-checkout-session', {
                product,
            }, {
                oxyServices,
                activeSessionId: activeSessionId || undefined,
            });

            if (response.data.success && response.data.url) {
                await Linking.openURL(response.data.url);
            } else {
                throw new Error(response.data.error?.message || 'Failed to create checkout session');
            }
        } catch (error: any) {
            console.error('Donation error:', error);
            Alert.alert(
                'Error',
                error.message || 'Unable to process donation. Please try again later.'
            );
        } finally {
            setLoading(false);
        }
    };

    const renderDonationTier = (tier: DonationTier) => (
        <View key={tier.id} style={[styles.tierCard, tier.popular && styles.popularTier]}>
            {tier.popular && (
                <FilterChip
                    label="Most Popular"
                    selected={true}
                    onPress={() => { }}
                    disabled={true}
                    style={styles.popularBadge}
                    size="small"
                />
            )}

            <View style={styles.tierHeader}>
                <IconComponent
                    name={tier.icon}
                    size={24}
                    color={tier.popular ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                />
                <ThemedText style={[styles.tierTitle, tier.popular && styles.popularTierTitle]}>
                    {tier.title}
                </ThemedText>
            </View>

            <ThemedText style={styles.tierDescription}>{tier.description}</ThemedText>

            <View style={styles.amountContainer}>
                <ThemedText style={[styles.currency, tier.popular && styles.popularCurrency]}>
                    {tier.currency}
                </ThemedText>
                <ThemedText style={[styles.amount, tier.popular && styles.popularAmount]}>
                    {tier.amount}
                </ThemedText>
                {tier.type !== 'one-time' && (
                    <ThemedText style={styles.period}>/{tier.type === 'monthly' ? 'mo' : 'mo'}</ThemedText>
                )}
            </View>

            <View style={styles.benefitsList}>
                {tier.benefits.map((benefit, index) => (
                    <View key={index} style={styles.benefitItem}>
                        <IconComponent name="checkmark" size={16} color={colors.primaryColor} />
                        <ThemedText style={styles.benefitText}>{benefit}</ThemedText>
                    </View>
                ))}
            </View>

            <ActionButton
                icon="heart"
                text={tier.type === 'one-time' ? t('donations.page.tiers.supporter.button') :
                    tier.type === 'monthly' ? t('donations.page.tiers.monthly.button') :
                        t('donations.page.tiers.founder.button')}
                onPress={() => handleDonation(tier)}
                disabled={loading}
                variant={tier.popular ? 'primary' : 'secondary'}
            />
        </View>
    );

    return (
        <SafeAreaView style={styles.container}>
            <Header
                options={{
                    title: t('donations.page.title'),
                    showBackButton: true,
                }}
            />

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* Hero Section */}
                <LinearGradient
                    colors={[colors.primaryColor, colors.primaryColor + '90']}
                    style={styles.heroSection}
                >
                    <IconComponent name="heart" size={48} color="#FFFFFF" />
                    <ThemedText style={styles.heroTitle}>
                        {t('donations.page.subtitle')}
                    </ThemedText>
                    <ThemedText style={styles.heroDescription}>
                        {t('donations.page.description')}
                    </ThemedText>
                </LinearGradient>

                {/* Donation Tiers */}
                <View style={styles.tiersSection}>
                    <ThemedText style={styles.sectionTitle}>
                        {t('donations.page.chooseContribution')}
                    </ThemedText>

                    {donationTiers.map(renderDonationTier)}
                </View>

                {/* Impact Section */}
                <View style={styles.impactSection}>
                    <ThemedText style={styles.sectionTitle}>
                        {t('donations.page.impact.title')}
                    </ThemedText>

                    {impactAreas.map((area, index) => (
                        <View key={index} style={styles.impactItem}>
                            <View style={styles.impactIcon}>
                                <IconComponent name={area.icon} size={20} color={colors.primaryColor} />
                            </View>
                            <View style={styles.impactContent}>
                                <ThemedText style={styles.impactTitle}>{area.title}</ThemedText>
                                <ThemedText style={styles.impactDescription}>{area.description}</ThemedText>
                            </View>
                        </View>
                    ))}
                </View>

                {/* Why Support Section */}
                <View style={styles.whySection}>
                    <ThemedText style={styles.sectionTitle}>
                        {t('donations.page.mission.title')}
                    </ThemedText>
                    <ThemedText style={styles.whyDescription}>
                        {t('donations.page.mission.description')}
                    </ThemedText>

                    <View style={styles.whyList}>
                        {(t('donations.page.mission.goals', { returnObjects: true }) as string[]).map((item: string, index: number) => (
                            <View key={index} style={styles.whyItem}>
                                <IconComponent name="arrow-forward" size={16} color={colors.primaryColor} />
                                <ThemedText style={styles.whyItemText}>{item}</ThemedText>
                            </View>
                        ))}
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.primaryLight,
    },
    content: {
        flex: 1,
    },
    heroSection: {
        padding: 24,
        alignItems: 'center',
        marginHorizontal: 16,
        marginTop: 16,
        borderRadius: 200,
        paddingHorizontal: 35,
    },
    heroTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#FFFFFF',
        textAlign: 'center',
        marginTop: 16,
    },
    heroDescription: {
        fontSize: 16,
        color: '#FFFFFF',
        textAlign: 'center',
        marginTop: 12,
        opacity: 0.9,
        lineHeight: 22,
    },
    tiersSection: {
        padding: 16,
        gap: 16,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 8,
    },
    tierCard: {
        backgroundColor: colors.primaryLight,
        borderRadius: 16,
        padding: 20,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
        position: 'relative',
    },
    popularTier: {
        borderColor: colors.primaryColor,
        borderWidth: 2,
    },
    popularBadge: {
        position: 'absolute',
        top: -1,
        left: 20,
    },
    tierHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: 8,
    },
    tierTitle: {
        fontSize: 18,
        fontWeight: '600',
    },
    popularTierTitle: {
        color: colors.primaryColor,
    },
    tierDescription: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginTop: 8,
    },
    amountContainer: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginTop: 16,
        marginBottom: 16,
    },
    currency: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    popularCurrency: {
        color: colors.primaryColor,
    },
    amount: {
        fontSize: 32,
        fontWeight: 'bold',
        marginLeft: 2,
    },
    popularAmount: {
        color: colors.primaryColor,
    },
    period: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginLeft: 2,
    },
    benefitsList: {
        gap: 8,
        marginBottom: 20,
    },
    benefitItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    benefitText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        flex: 1,
    },
    impactSection: {
        padding: 16,
        gap: 16,
    },
    impactItem: {
        flexDirection: 'row',
        gap: 12,
        alignItems: 'flex-start',
    },
    impactIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.primaryLight_2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    impactContent: {
        flex: 1,
    },
    impactTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    impactDescription: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
        lineHeight: 20,
    },
    whySection: {
        padding: 16,
        backgroundColor: colors.COLOR_BLACK_LIGHT_8,
        marginHorizontal: 16,
        borderRadius: 16,
        marginBottom: 16,
    },
    whyDescription: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
        lineHeight: 20,
        marginBottom: 16,
    },
    whyList: {
        gap: 12,
    },
    whyItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
    },
    whyItemText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        flex: 1,
        lineHeight: 20,
    },
});
