import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { SindiIcon } from '@/assets/icons';
import { colors } from '@/styles/colors';
import { Property } from '@homiio/shared-types';

interface SindiAnalysisProps {
    property: Property;
}

export const SindiAnalysis: React.FC<SindiAnalysisProps> = ({ property }) => property.isVerified ? (
    <View style={styles.sindiContainer}>
        <View style={styles.sindiHeader}>
            <View style={styles.sindiIconContainer}>
                <SindiIcon size={32} color="white" />
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
        marginBottom: 20,
        borderRadius: 100,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
        padding: 12,
        backgroundColor: colors.primaryColor,
    },
    sindiHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    sindiIconContainer: {
        width: 50,
        height: 50,
        borderRadius: 35,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
    },
    sindiTextContainer: { flex: 1, gap: 4 },
    sindiTitle: { fontSize: 16, fontWeight: '700', color: 'white' },
    sindiDescription: { fontSize: 14, color: 'rgba(255, 255, 255, 0.9)', lineHeight: 20 },
});
