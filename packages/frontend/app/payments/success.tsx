import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useOxy } from '@oxyhq/services';
import { api } from '@/utils/api';

export default function PaymentSuccessScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const { oxyServices, activeSessionId } = useOxy();
    const [confirmed, setConfirmed] = useState(false);
    const [confirming, setConfirming] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const confirm = async () => {
            const sessionId = params.session_id as string | undefined;
            if (!sessionId) {
                setError('No session ID found');
                setConfirming(false);
                return;
            }

            try {
                console.log('🔔 Confirming payment session:', sessionId);
                setConfirming(true);
                setError(null);

                let success = false;

                // Try the confirm endpoint first
                if (oxyServices && activeSessionId) {
                    try {
                        const response = await api.post('/api/billing/confirm', { session_id: sessionId }, { oxyServices, activeSessionId });
                        console.log('✅ Payment confirmed:', response.data);
                        setConfirmed(true);
                        success = true;
                    } catch (confirmError: any) {
                        console.warn('⚠️ Confirm endpoint failed, trying manual activation:', confirmError.message);

                        // Fallback to manual activation
                        try {
                            const manualResponse = await api.post('/api/billing/manual-activate', {
                                session_id: sessionId,
                                product: 'plus'
                            }, { oxyServices, activeSessionId });
                            console.log('✅ Manual activation successful:', manualResponse.data);
                            setConfirmed(true);
                            success = true;
                        } catch (manualError: any) {
                            console.error('❌ Manual activation also failed:', manualError);
                            throw manualError;
                        }
                    }
                } else {
                    // Try without auth as fallback
                    try {
                        const response = await api.post('/api/billing/confirm', { session_id: sessionId });
                        console.log('✅ Payment confirmed (no auth):', response.data);
                        setConfirmed(true);
                        success = true;
                    } catch (confirmError: any) {
                        console.warn('⚠️ Confirm endpoint failed (no auth), trying manual activation');
                        throw confirmError;
                    }
                }

                if (!success) {
                    throw new Error('All confirmation methods failed');
                }

            } catch (e: any) {
                console.error('❌ Payment confirmation failed:', e);
                setError(e?.response?.data?.error?.message || e?.message || 'Failed to confirm payment');
                // Don't show error to user immediately - webhook might have succeeded
            } finally {
                setConfirming(false);
            }
        };

        confirm();
    }, [params.session_id, oxyServices, activeSessionId]);

    useEffect(() => {
        // On web, attempt to close popup if this was opened via window.open
        if (Platform.OS === 'web') {
            try {
                if (window.opener) {
                    window.opener.postMessage({ type: 'HOMIIO_PAYMENT_SUCCESS', sessionId: params.session_id }, '*');
                }
                setTimeout(() => window.close(), 2000); // Give more time for confirmation
            } catch { }
        }
    }, [params.session_id]);

    const handleRetry = () => {
        setConfirming(true);
        setError(null);
        // Retry confirmation
        const sessionId = params.session_id as string | undefined;
        if (sessionId) {
            api.post('/api/billing/confirm', { session_id: sessionId }, { oxyServices, activeSessionId })
                .then(() => {
                    setConfirmed(true);
                    setError(null);
                })
                .catch((e: any) => {
                    // Try manual activation as fallback
                    return api.post('/api/billing/manual-activate', {
                        session_id: sessionId,
                        product: 'plus'
                    }, { oxyServices, activeSessionId });
                })
                .then(() => {
                    setConfirmed(true);
                    setError(null);
                })
                .catch((e: any) => {
                    setError(e?.response?.data?.error?.message || 'Retry failed');
                })
                .finally(() => setConfirming(false));
        }
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.card}>
                <Text style={styles.title}>Payment successful</Text>
                <Text style={styles.subtitle}>
                    Thanks for supporting Homiio. Your access will be enabled shortly.
                </Text>

                {confirming && (
                    <View style={styles.statusRow}>
                        <View style={{ width: 20, height: 20, justifyContent: 'center', alignItems: 'center' }}>
                          <View style={{ 
                            width: 16, 
                            height: 16, 
                            borderWidth: 2, 
                            borderColor: '#007AFF', 
                            borderTopColor: 'transparent',
                            borderRadius: 8 
                          }} />
                        </View>
                        <Text style={styles.statusText}>Updating your account…</Text>
                    </View>
                )}

                {confirmed && (
                    <View style={styles.statusRow}>
                        <Text style={styles.successText}>✅ Account updated successfully!</Text>
                    </View>
                )}

                {error && (
                    <View style={styles.statusRow}>
                        <Text style={styles.errorText}>⚠️ {error}</Text>
                        <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
                            <Text style={styles.retryBtnText}>Retry</Text>
                        </TouchableOpacity>
                    </View>
                )}

                <TouchableOpacity
                    style={styles.btn}
                    onPress={() => router.replace('/profile/subscriptions')}
                >
                    <Text style={styles.btnText}>Back to subscriptions</Text>
                </TouchableOpacity>

                <Text style={styles.note}>
                    If you don&apos;t see your subscription active, please refresh the subscriptions page or contact support.
                </Text>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f7f8f9', alignItems: 'center', justifyContent: 'center' },
    card: { backgroundColor: '#fff', padding: 20, margin: 16, borderRadius: 16, borderWidth: 1, borderColor: '#e9edef', maxWidth: 520, width: '90%' },
    title: { fontSize: 22, fontWeight: '800', color: '#111b21', marginBottom: 8 },
    subtitle: { color: '#344053', marginBottom: 16 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    statusText: { color: '#667781' },
    successText: { color: '#059669', fontWeight: '600' },
    errorText: { color: '#dc2626', flex: 1 },
    retryBtn: { backgroundColor: '#2563eb', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
    retryBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
    btn: { backgroundColor: '#2563eb', paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 8 },
    btnText: { color: '#fff', fontWeight: '700' },
    note: { color: '#667781', fontSize: 12, marginTop: 12, textAlign: 'center' }
});
