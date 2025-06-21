import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { useOxy } from '@oxyhq/services';
import { TrustScoreManager } from '@/components/TrustScoreManager';

export default function TrustScorePage() {
    const { t } = useTranslation();
    const { showBottomSheet } = useOxy();

    return (
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <View style={styles.header}>
                <Text style={styles.title}>{t('Trust Score')}</Text>
                <Text style={styles.subtitle}>
                    Build trust with landlords and roommates through verification and positive interactions
                </Text>
            </View>

            <TrustScoreManager />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    header: {
        padding: 20,
        backgroundColor: colors.primaryLight,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        marginBottom: 8,
        color: colors.primaryDark,
    },
    subtitle: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_4,
        lineHeight: 22,
    },
}); 