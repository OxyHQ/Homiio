import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';
import { ThemedText } from '../ThemedText';

export function HorizonInitiativeWidget() {
    const { t } = useTranslation();

    return (
        <BaseWidget
            title={t("Horizon Initiative")}
            icon={<Ionicons name="star" size={22} color="#FFD700" />}
        >
            <ThemedText style={styles.membershipText}>
                Horizon is a global initiative offering fair housing, healthcare, and travel support. Integrated with Homiio, it ensures affordable living within a connected, sustainable network.
            </ThemedText>
            <TouchableOpacity
                style={styles.joinButton}
                onPress={() => {
                    const url = "https://oxy.so/horizon";
                    window.open(url, "_blank");
                }}
            >
                <ThemedText style={styles.joinButtonText}>Learn More</ThemedText>
            </TouchableOpacity>
        </BaseWidget>
    );
}

const styles = StyleSheet.create({
    membershipText: {
        marginBottom: 15,
        lineHeight: 20,
    },
    joinButton: {
        backgroundColor: '#c2e3ff',
        paddingVertical: 10,
        borderRadius: 25,
        alignItems: 'center',
    },
    joinButtonText: {
        color: '#002646',
        fontWeight: 'bold',
        fontFamily: 'Phudu',
    },
}); 