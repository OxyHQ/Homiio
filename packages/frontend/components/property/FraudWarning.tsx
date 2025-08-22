import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';

export const FraudWarning: React.FC<{ text: string }> = ({ text }) => (
    <View style={styles.fraudWarningContainer}>
        <ThemedText style={styles.fraudWarningText}>{text}</ThemedText>
    </View>
);

const styles = StyleSheet.create({
    fraudWarningContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF8E1',
        padding: 10,
        borderRadius: 8,
    },
    fraudWarningText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        textAlign: 'center',
        fontStyle: 'italic',
    },
});
