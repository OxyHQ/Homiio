import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons as Icon } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { useOxy } from '@oxyhq/services';
import { useSubscriptionStore } from '@/store/subscriptionStore';
import { api } from '@/utils/api';

export default function SubscriptionsScreen() {
    const router = useRouter();
    const { oxyServices, activeSessionId } = useOxy();

    const {
        entitlements,
        isLoading,
        error,
        loadingStates,
        fetchEntitlements,
        startCheckout,
        openCustomerPortal,
        syncSubscription,
        cancelSubscription,
        resetError
    } = useSubscriptionStore();

    // Fetch entitlements on mount
    useEffect(() => {
        if (oxyServices && activeSessionId) {
            fetchEntitlements(oxyServices, activeSessionId);
        }
    }, [oxyServices, activeSessionId]);

    // Show error alerts
    useEffect(() => {
        if (error) {
            Alert.alert('Error', error);
            resetError();
        }
    }, [error]);

    const plusActive = entitlements?.plusActive || false;
    const plusSince = entitlements?.plusSince;
    const plusCanceledAt = entitlements?.plusCanceledAt;
    const fileCredits = entitlements?.fileCredits || 0;
    const lastPayment = entitlements?.lastPaymentAt;

    const onRefresh = async () => {
        if (oxyServices && activeSessionId) {
            await fetchEntitlements(oxyServices, activeSessionId);
        }
    };

    const handleStartCheckout = async (product: 'plus' | 'file' | 'founder') => {
        if (!oxyServices || !activeSessionId) {
            Alert.alert('Error', 'Authentication required');
            return;
        }

        try {
            await startCheckout(product, oxyServices, activeSessionId);
        } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to start checkout');
        }
    };

    const handleManageSubscription = async () => {
        if (!oxyServices || !activeSessionId) {
            Alert.alert('Error', 'Authentication required');
            return;
        }

        try {
            await openCustomerPortal(oxyServices, activeSessionId);
        } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to open subscription management');
        }
    };

    const handleSyncSubscription = async () => {
        if (!oxyServices || !activeSessionId) {
            Alert.alert('Error', 'Authentication required');
            return;
        }

        try {
            await syncSubscription(oxyServices, activeSessionId);
            Alert.alert('Success', 'Subscription status synced from Stripe');
        } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to sync subscription');
        }
    };

    const handleCancelSubscription = async (immediate: boolean) => {
        if (!oxyServices || !activeSessionId) {
            Alert.alert('Error', 'Authentication required');
            return;
        }

        if (immediate) {
            Alert.alert(
                'Cancel Immediately',
                'This will immediately cancel your subscription and you will lose access to Homiio+ features. Are you sure?',
                [
                    { text: 'No', style: 'cancel' },
                    {
                        text: 'Yes, Cancel Now',
                        style: 'destructive',
                        onPress: async () => {
                            try {
                                await cancelSubscription(true, oxyServices, activeSessionId);
                                Alert.alert('Success', 'Subscription canceled immediately');
                            } catch (error: any) {
                                Alert.alert('Error', error.message || 'Failed to cancel subscription');
                            }
                        }
                    }
                ]
            );
        } else {
            try {
                await cancelSubscription(false, oxyServices, activeSessionId);
                Alert.alert('Success', 'Subscription will be canceled at the end of the current period');
            } catch (error: any) {
                Alert.alert('Error', error.message || 'Failed to cancel subscription');
            }
        }
    };

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <ScrollView
                style={styles.scrollView}
                refreshControl={
                    <RefreshControl refreshing={isLoading} onRefresh={onRefresh} />
                }
            >
                {/* Header */}
                <View style={styles.header}>
                    <View style={styles.headerIcon}>
                        <Icon name="home" size={24} color={colors.primaryColor} />
                    </View>
                    <Text style={styles.headerTitle}>Homiio+</Text>
                    <Text style={styles.headerSubtitle}>Your ethical housing ally</Text>
                    <Text style={styles.introText}>
                        Your subscription gives you access to Sindi, the legal assistant that scans your rental contracts and flags abusive clauses. No ads, no speculation, no data selling.
                    </Text>
                </View>

                {/* Pay per contract */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <Icon name="document-text" size={24} color={colors.primaryColor} />
                        <View style={styles.cardTitleContainer}>
                            <Text style={styles.cardTitle}>Pay per contract</Text>
                            <Text style={styles.cardPrice}>5 € per contract review</Text>
                        </View>
                    </View>

                    <Text style={styles.cardDesc}>
                        Perfect for one-time use.
                    </Text>

                    <TouchableOpacity
                        style={[styles.secondaryBtn, loadingStates.checkout && styles.disabledBtn]}
                        disabled={loadingStates.checkout}
                        onPress={() => handleStartCheckout('file')}
                    >
                        <Text style={styles.secondaryBtnText}>
                            {loadingStates.checkout ? 'Starting…' : 'Review Contract'}
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Homiio+ Subscription - Highlighted */}
                <View style={[styles.card, styles.highlightedCard]}>
                    {plusActive && (
                        <View style={styles.activeBadge}>
                            <Icon name="checkmark-circle" size={16} color="#fff" />
                            <Text style={styles.activeBadgeText}>Active subscription</Text>
                        </View>
                    )}

                    {plusCanceledAt && !plusActive && (
                        <View style={styles.canceledBadge}>
                            <Icon name="close-circle" size={16} color="#fff" />
                            <Text style={styles.canceledBadgeText}>Canceled on {formatDate(plusCanceledAt)}</Text>
                        </View>
                    )}

                    <View style={styles.cardHeader}>
                        <Icon name="star" size={24} color={colors.primaryColor} />
                        <View style={styles.cardTitleContainer}>
                            <Text style={styles.cardTitle}>Homiio+ Subscription</Text>
                            <Text style={styles.cardPrice}>9.99 €/month</Text>
                        </View>
                    </View>

                    <Text style={styles.cardDesc}>
                        Includes up to 10 contracts per month free. From the 11th contract onwards: 2.50 € each.
                    </Text>

                    <View style={styles.featuresList}>
                        <View style={styles.featureItem}>
                            <Icon name="checkmark-circle" size={16} color="#10b981" />
                            <Text style={styles.featureText}>Unlimited contract history</Text>
                        </View>
                        <View style={styles.featureItem}>
                            <Icon name="checkmark-circle" size={16} color="#10b981" />
                            <Text style={styles.featureText}>Legal alerts & notifications</Text>
                        </View>
                        <View style={styles.featureItem}>
                            <Icon name="checkmark-circle" size={16} color="#10b981" />
                            <Text style={styles.featureText}>Priority support</Text>
                        </View>
                    </View>

                    <TouchableOpacity
                        style={[styles.primaryBtn, loadingStates.checkout && styles.disabledBtn]}
                        disabled={loadingStates.checkout}
                        onPress={() => {
                            if (plusActive) {
                                handleManageSubscription();
                            } else {
                                handleStartCheckout('plus');
                            }
                        }}
                    >
                        <Text style={styles.primaryBtnText}>
                            {plusActive ? 'Manage subscription' : plusCanceledAt ? 'Resubscribe' : loadingStates.checkout ? 'Starting…' : 'Subscribe now'}
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Founder supporter */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <Icon name="heart" size={24} color={colors.primaryColor} />
                        <View style={styles.cardTitleContainer}>
                            <Text style={styles.cardTitle}>Founder supporter</Text>
                            <Text style={styles.cardPrice}>Contribution from 10 €/month</Text>
                        </View>
                    </View>

                    <Text style={styles.cardDesc}>
                        Support Homiio&apos;s independence. Get recognition in the app + early access to features.
                    </Text>

                    <TouchableOpacity
                        style={[styles.secondaryBtn, loadingStates.checkout && styles.disabledBtn]}
                        disabled={loadingStates.checkout}
                        onPress={() => handleStartCheckout('founder')}
                    >
                        <Text style={styles.secondaryBtnText}>
                            {loadingStates.checkout ? 'Starting…' : 'Become a Supporter'}
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Footer */}
                <View style={styles.footer}>
                    <Text style={styles.footerText}>
                        Every euro keeps Homiio ethical, independent, and community-driven.
                    </Text>
                </View>

                {/* Debug Info (only show in development) */}
                {__DEV__ && (
                    <View style={styles.debugSection}>
                        <Text style={styles.debugTitle}>Debug Info:</Text>
                        <Text style={styles.debugText}>Plus Active: {plusActive ? 'Yes' : 'No'}</Text>
                        <Text style={styles.debugText}>Subscription ID: {entitlements?.plusStripeSubscriptionId || 'None'}</Text>
                        <Text style={styles.debugText}>File Credits: {fileCredits}</Text>
                        <Text style={styles.debugText}>Last Payment: {formatDate(lastPayment)}</Text>
                        <Text style={styles.debugText}>Plus Since: {formatDate(plusSince)}</Text>
                        <Text style={styles.debugText}>Plus Canceled: {formatDate(plusCanceledAt)}</Text>

                        {/* Manual Cancel Button for Testing */}
                        {plusActive && (
                            <View style={{ marginTop: 16 }}>
                                <Text style={[styles.debugText, { marginBottom: 8 }]}>Test Cancellation:</Text>
                                <TouchableOpacity
                                    style={[styles.primaryBtn, { marginBottom: 8, backgroundColor: '#dc2626' }]}
                                    onPress={() => handleCancelSubscription(false)}
                                >
                                    <Text style={styles.primaryBtnText}>Cancel at Period End</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.primaryBtn, { backgroundColor: '#dc2626' }]}
                                    onPress={() => handleCancelSubscription(true)}
                                >
                                    <Text style={styles.primaryBtnText}>Cancel Immediately</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* Sync Subscription Button */}
                        <TouchableOpacity
                            style={[styles.primaryBtn, { marginTop: 8, backgroundColor: '#3b82f6' }]}
                            onPress={handleSyncSubscription}
                        >
                            <Text style={styles.primaryBtnText}>Sync from Stripe</Text>
                        </TouchableOpacity>

                        {/* Debug Subscription Button */}
                        <TouchableOpacity
                            style={[styles.primaryBtn, { marginTop: 8, backgroundColor: '#8b5cf6' }]}
                            onPress={async () => {
                                try {
                                    const response = await api.get('/api/billing/debug-subscription', { oxyServices, activeSessionId: activeSessionId || undefined });
                                    if (response.data.success) {
                                        console.log('🔍 Debug info:', response.data.debugInfo);
                                        Alert.alert(
                                            'Debug Info',
                                            `Database Active: ${response.data.debugInfo.database.plusActive}\n` +
                                            `Stripe Status: ${response.data.debugInfo.stripe?.status || 'Error'}\n` +
                                            `Cancel at Period End: ${response.data.debugInfo.stripe?.cancel_at_period_end || 'N/A'}\n` +
                                            `Needs Sync: ${response.data.debugInfo.comparison?.needsSync || 'Unknown'}\n` +
                                            `Sync Action: ${response.data.debugInfo.comparison?.syncAction || 'Unknown'}`
                                        );
                                    }
                                } catch (error: any) {
                                    Alert.alert('Error', error.message || 'Failed to debug subscription');
                                }
                            }}
                        >
                            <Text style={styles.primaryBtnText}>Debug Subscription</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Navigation */}
                <View style={styles.navRow}>
                    <TouchableOpacity style={styles.linkBtn} onPress={() => router.back()}>
                        <Icon name="chevron-back" size={18} color="#111b21" />
                        <Text style={styles.linkBtnText}>Back</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fafbfc' },
    scrollView: { flex: 1 },
    header: {
        paddingHorizontal: 16,
        paddingTop: 20,
        paddingBottom: 16,
        alignItems: 'center'
    },
    headerIcon: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
        position: 'relative'
    },
    shieldIcon: {
        position: 'absolute',
        top: -2,
        right: -2
    },
    headerTitle: { fontSize: 28, fontWeight: '800', color: '#111b21', marginBottom: 8 },
    headerSubtitle: { fontSize: 16, color: '#6b7280', lineHeight: 22, textAlign: 'center' },
    introText: {
        color: '#6b7280',
        fontSize: 15,
        lineHeight: 22,
        textAlign: 'center'
    },
    card: {
        backgroundColor: '#fff',
        margin: 16,
        padding: 20,
        borderRadius: 12,
        borderWidth: 0.5,
        borderColor: '#eaeaea'
    },
    highlightedCard: {
        borderColor: colors.primaryColor,
        borderWidth: 2,
        backgroundColor: '#fef2f2'
    },
    activeBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primaryColor,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 20,
        marginBottom: 12,
        alignSelf: 'flex-start'
    },
    activeBadgeText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '700',
        marginLeft: 8
    },
    canceledBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#dc2626', // Red for canceled
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 20,
        marginBottom: 12,
        alignSelf: 'flex-start'
    },
    canceledBadgeText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '700',
        marginLeft: 8
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
        gap: 12
    },
    cardTitleContainer: { flex: 1 },
    cardTitle: { fontSize: 20, fontWeight: '700', color: '#111b21' },
    cardPrice: { fontSize: 16, fontWeight: '600', color: colors.primaryColor, marginTop: 2 },
    cardDesc: {
        color: '#6b7280',
        marginBottom: 16,
        lineHeight: 20,
        fontSize: 15
    },
    featuresList: { marginBottom: 20, gap: 8 },
    featureItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8
    },
    featureText: { color: '#374151', fontSize: 14 },
    primaryBtn: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center'
    },
    primaryBtnText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 16
    },
    secondaryBtn: {
        borderWidth: 1,
        borderColor: colors.primaryColor,
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
        backgroundColor: '#fff'
    },
    secondaryBtnText: {
        color: colors.primaryColor,
        fontWeight: '700',
        fontSize: 16
    },
    disabledBtn: {
        opacity: 0.6
    },
    footer: {
        paddingHorizontal: 16,
        marginBottom: 16,
        alignItems: 'center'
    },
    footerText: {
        color: '#6b7280',
        fontSize: 13,
        lineHeight: 18,
        textAlign: 'center'
    },
    debugLink: {
        alignSelf: 'center',
        marginTop: 8,
        marginBottom: 16
    },
    debugLinkText: {
        color: '#6b7280',
        fontSize: 14,
        textDecorationLine: 'underline'
    },
    debugSection: {
        backgroundColor: '#f0f0f0',
        padding: 16,
        borderRadius: 8,
        marginHorizontal: 16,
        marginBottom: 16,
        borderWidth: 0.5,
        borderColor: '#e0e0e0'
    },
    debugTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#333',
        marginBottom: 8
    },
    debugText: {
        fontSize: 14,
        color: '#555',
        marginBottom: 4
    },
    navRow: { padding: 16, flexDirection: 'row' },
    linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    linkBtnText: { color: '#111b21', fontWeight: '600' },
});
