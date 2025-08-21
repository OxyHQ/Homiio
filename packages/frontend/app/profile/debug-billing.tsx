import React, { useState, useEffect } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useOxy } from '@oxyhq/services';
import { api } from '@/utils/api';
import { useRouter } from 'expo-router';

interface BillingInfo {
    profileId: string;
    oxyUserId: string;
    billing: any;
    hasBilling: boolean;
    plusActive: boolean;
    plusSince?: string;
    plusStripeSubscriptionId?: string;
    fileCredits: number;
    lastPaymentAt?: string;
    processedSessions: string[];
    processedSessionsCount: number;
}

export default function DebugBillingScreen() {
    const router = useRouter();
    const { oxyServices, activeSessionId } = useOxy();
    const [billingInfo, setBillingInfo] = useState<BillingInfo | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchBillingInfo = async () => {
        if (!oxyServices || !activeSessionId) {
            setError('Authentication required');
            return;
        }

        try {
            setLoading(true);
            setError(null);

            const response = await api.get('/api/billing/debug-billing', { oxyServices, activeSessionId });

            if (response.data?.success) {
                setBillingInfo(response.data.billing);
            } else {
                setError('Failed to fetch billing info');
            }
        } catch (err: any) {
            console.error('Error fetching billing info:', err);
            setError(err?.response?.data?.error?.message || err?.message || 'Failed to fetch billing info');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBillingInfo();
    }, [oxyServices, activeSessionId]);

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleString();
    };

    if (!oxyServices || !activeSessionId) {
        return (
            <SafeAreaView style={styles.container} edges={['top']}>
                <View style={styles.card}>
                    <Text style={styles.title}>Debug Billing</Text>
                    <Text style={styles.errorText}>Please sign in to view billing information</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <ScrollView style={styles.scrollView}>
                <View style={styles.header}>
                    <Text style={styles.title}>Debug Billing Status</Text>
                    <Text style={styles.subtitle}>Check if your subscription is saved in the database</Text>
                </View>

                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <Text style={styles.cardTitle}>Current Status</Text>
                        <TouchableOpacity style={styles.refreshBtn} onPress={fetchBillingInfo} disabled={loading}>
                            <Text style={styles.refreshBtnText}>{loading ? 'Loading...' : 'Refresh'}</Text>
                        </TouchableOpacity>
                    </View>

                    {loading && (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator />
                            <Text style={styles.loadingText}>Loading billing information...</Text>
                        </View>
                    )}

                    {error && (
                        <View style={styles.errorContainer}>
                            <Text style={styles.errorText}>❌ {error}</Text>
                        </View>
                    )}

                    {billingInfo && (
                        <View style={styles.infoContainer}>
                            <View style={styles.infoRow}>
                                <Text style={styles.label}>Profile ID:</Text>
                                <Text style={styles.value}>{billingInfo.profileId}</Text>
                            </View>

                            <View style={styles.infoRow}>
                                <Text style={styles.label}>User ID:</Text>
                                <Text style={styles.value}>{billingInfo.oxyUserId}</Text>
                            </View>

                            <View style={styles.infoRow}>
                                <Text style={styles.label}>Plus Active:</Text>
                                <Text style={[styles.value, billingInfo.plusActive ? styles.successText : styles.errorText]}>
                                    {billingInfo.plusActive ? '✅ YES' : '❌ NO'}
                                </Text>
                            </View>

                            <View style={styles.infoRow}>
                                <Text style={styles.label}>Plus Since:</Text>
                                <Text style={styles.value}>{formatDate(billingInfo.plusSince)}</Text>
                            </View>

                            <View style={styles.infoRow}>
                                <Text style={styles.label}>Stripe Subscription ID:</Text>
                                <Text style={styles.value}>{billingInfo.plusStripeSubscriptionId || 'N/A'}</Text>
                            </View>

                            <View style={styles.infoRow}>
                                <Text style={styles.label}>File Credits:</Text>
                                <Text style={styles.value}>{billingInfo.fileCredits}</Text>
                            </View>

                            <View style={styles.infoRow}>
                                <Text style={styles.label}>Last Payment:</Text>
                                <Text style={styles.value}>{formatDate(billingInfo.lastPaymentAt)}</Text>
                            </View>

                            <View style={styles.infoRow}>
                                <Text style={styles.label}>Processed Sessions:</Text>
                                <Text style={styles.value}>{billingInfo.processedSessionsCount}</Text>
                            </View>

                            {billingInfo.processedSessions.length > 0 && (
                                <View style={styles.sessionsContainer}>
                                    <Text style={styles.sessionsTitle}>Session IDs:</Text>
                                    {billingInfo.processedSessions.map((sessionId, index) => (
                                        <Text key={index} style={styles.sessionId}>{sessionId}</Text>
                                    ))}
                                </View>
                            )}

                            <View style={styles.summaryContainer}>
                                <Text style={styles.summaryTitle}>Summary:</Text>
                                <Text style={styles.summaryText}>
                                    {billingInfo.plusActive
                                        ? '✅ Your Plus subscription is active and saved in the database!'
                                        : '❌ Your Plus subscription is not active. The payment may not have been processed correctly.'
                                    }
                                </Text>
                            </View>
                        </View>
                    )}
                </View>

                <View style={styles.navRow}>
                    <TouchableOpacity style={styles.linkBtn} onPress={() => router.back()}>
                        <Text style={styles.linkBtnText}>← Back</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f7f8f9' },
    scrollView: { flex: 1 },
    header: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
    title: { fontSize: 24, fontWeight: '800', color: '#111b21' },
    subtitle: { marginTop: 6, color: '#344053' },
    card: { backgroundColor: '#fff', margin: 16, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#e9edef' },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    cardTitle: { fontSize: 18, fontWeight: '700', color: '#111b21' },
    refreshBtn: { backgroundColor: '#2563eb', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
    refreshBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
    loadingContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 20 },
    loadingText: { color: '#667781' },
    errorContainer: { paddingVertical: 12 },
    errorText: { color: '#dc2626', fontWeight: '600' },
    infoContainer: { gap: 12 },
    infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    label: { color: '#344053', fontWeight: '600', flex: 1 },
    value: { color: '#111b21', flex: 2, textAlign: 'right' },
    successText: { color: '#059669' },
    sessionsContainer: { marginTop: 8 },
    sessionsTitle: { color: '#344053', fontWeight: '600', marginBottom: 4 },
    sessionId: { color: '#667781', fontSize: 12, fontFamily: 'monospace', marginBottom: 2 },
    summaryContainer: { marginTop: 16, padding: 12, backgroundColor: '#f8fafc', borderRadius: 8 },
    summaryTitle: { color: '#111b21', fontWeight: '700', marginBottom: 4 },
    summaryText: { color: '#344053', lineHeight: 20 },
    navRow: { padding: 16, flexDirection: 'row' },
    linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    linkBtnText: { color: '#111b21', fontWeight: '600' },
});
