import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';

export function TrustScoreWidget() {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <BaseWidget
            title={t("Trust Score")}
            icon={<Ionicons name="shield-checkmark" size={22} color={colors.primaryColor} />}
        >
            <View style={styles.trustScoreContent}>
                <View style={styles.scoreCircle}>
                    <Text style={styles.scoreNumber}>87</Text>
                </View>
                <Text style={styles.trustScoreText}>Your trust score is Good</Text>
                <TouchableOpacity
                    style={styles.improveButton}
                    onPress={() => {
                        router.push('/profile/trust-score');
                    }}
                >
                    <Text style={styles.improveButtonText}>Improve Score</Text>
                </TouchableOpacity>
            </View>
        </BaseWidget>
    );
}

const styles = StyleSheet.create({
    trustScoreContent: {
        alignItems: 'center',
        padding: 10,
    },
    scoreCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: colors.primaryColor,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 15,
    },
    scoreNumber: {
        color: 'white',
        fontSize: 24,
        fontWeight: 'bold',
    },
    trustScoreText: {
        fontSize: 16,
        marginBottom: 15,
    },
    improveButton: {
        backgroundColor: '#f0f0f0',
        paddingVertical: 8,
        paddingHorizontal: 15,
        borderRadius: 20,
    },
    improveButtonText: {
        color: colors.primaryColor,
        fontWeight: '600',
    },
}); 