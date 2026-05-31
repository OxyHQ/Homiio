import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { SindiIcon } from '@/assets/icons';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import { SECTION_GUTTER } from '@/components/property/Section';
import { Property } from '@homiio/shared-types';

interface SindiAnalysisProps {
    property: Property;
}

export const SindiAnalysis: React.FC<SindiAnalysisProps> = ({ property }) => property.isVerified ? (
    <View style={styles.sindiContainer}>
        <View style={styles.sindiHeader}>
            <View style={styles.sindiIconContainer}>
                <SindiIcon size={32} color={colors.primaryForeground} />
            </View>
            <View style={styles.sindiTextContainer}>
                <ThemedText style={styles.sindiTitle}>Sindi personally analyzed this property</ThemedText>
                <ThemedText style={styles.sindiDescription}>
                    I&apos;ve verified this property for authenticity and condition. Ask me anything about it!
                </ThemedText>
            </View>
        </View>
    </View>
) : null;

const styles = StyleSheet.create({
    sindiContainer: {
        borderRadius: radius.lg,
        marginHorizontal: SECTION_GUTTER,
        overflow: 'hidden',
        padding: spacing.lg,
        backgroundColor: colors.primaryColor,
    },
    sindiHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    sindiIconContainer: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
    },
    sindiTextContainer: { flex: 1, gap: spacing.xs },
    sindiTitle: { fontSize: 16, fontWeight: '700', color: colors.primaryForeground },
    sindiDescription: { fontSize: 14, color: 'rgba(255, 255, 255, 0.9)', lineHeight: 20 },
});

export default SindiAnalysis;
