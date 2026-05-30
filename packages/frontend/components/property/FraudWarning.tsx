import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import { SECTION_GUTTER } from '@/components/property/Section';

export const FraudWarning: React.FC<{ text: string }> = ({ text }) => (
    <View style={styles.fraudWarningContainer}>
        <ThemedText style={styles.fraudWarningText}>{text}</ThemedText>
    </View>
);

const styles = StyleSheet.create({
    fraudWarningContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.warningSubtle,
        marginHorizontal: SECTION_GUTTER,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.md,
    },
    fraudWarningText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        textAlign: 'center',
        fontStyle: 'italic',
    },
});
