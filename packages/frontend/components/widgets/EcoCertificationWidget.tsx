import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';
import { ThemedText } from '../ThemedText';

export function EcoCertificationWidget() {
    const { t } = useTranslation();

    return (
        <BaseWidget
            title={t('home.eco.title', 'Eco-Certified Properties')}
            icon={<Ionicons name="leaf" size={22} color="green" />}
        >
            <View style={styles.ecoCertContent}>
                <Text style={styles.ecoText}>
                    {t('home.eco.description', 'Find sustainable properties that meet our energy efficiency and eco-friendly standards')}
                </Text>
                <TouchableOpacity style={styles.learnMoreButton}>
                    <ThemedText style={styles.learnMoreText}>{t('home.horizon.learnMore', 'Learn More')}</ThemedText>
                </TouchableOpacity>
            </View>
        </BaseWidget>
    );
}

const styles = StyleSheet.create({
    ecoCertContent: {
        padding: 10,
        alignItems: 'center',
    },
    ecoText: {
        textAlign: 'center',
        marginBottom: 15,
        lineHeight: 20,
    },
    learnMoreButton: {
        paddingVertical: 8,
        paddingHorizontal: 15,
        backgroundColor: '#e7f4e4',
        borderRadius: 20,
    },
    learnMoreText: {
        color: 'green',
        fontWeight: 'bold',
        fontFamily: 'Phudu',
    },
}); 