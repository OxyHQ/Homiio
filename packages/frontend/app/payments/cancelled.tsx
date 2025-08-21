import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

export default function PaymentCancelledScreen() {
    const router = useRouter();
    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.card}>
                <Text style={styles.title}>Payment cancelled</Text>
                <Text style={styles.subtitle}>No charges were made. You can try again anytime.</Text>
                <TouchableOpacity style={styles.btn} onPress={() => router.replace('/profile/subscriptions')}>
                    <Text style={styles.btnText}>Back to subscriptions</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f7f8f9', alignItems: 'center', justifyContent: 'center' },
    card: { backgroundColor: '#fff', padding: 20, margin: 16, borderRadius: 16, borderWidth: 1, borderColor: '#e9edef', maxWidth: 520, width: '90%' },
    title: { fontSize: 22, fontWeight: '800', color: '#111b21', marginBottom: 8 },
    subtitle: { color: '#344053', marginBottom: 16 },
    btn: { backgroundColor: '#6b7280', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
    btnText: { color: '#fff', fontWeight: '700' }
});
