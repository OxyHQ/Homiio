import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { Section } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import { useTranslation } from 'react-i18next';
import type { Property } from '@homiio/shared-types';

interface Props { property: Property | null }

export const PropertyDetailsCard: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const type = property?.type;
    const floor = property?.floor;
    const yearBuilt = property?.yearBuilt;
    const parkingSpaces = property?.parkingSpaces;
    return (
        <Section title={t('Property Details') || 'Property Details'}>
            <View style={styles.grid}>
                <View style={styles.item}>
                    <BloomText style={styles.label}>{t('Property Type') || 'Property Type'}</BloomText>
                    <BloomText style={styles.value}>{type ? type.charAt(0).toUpperCase() + type.slice(1) : t('Not specified') || 'Not specified'}</BloomText>
                </View>
                {floor !== undefined && (
                    <View style={styles.item}>
                        <BloomText style={styles.label}>{t('Floor') || 'Floor'}</BloomText>
                        <BloomText style={styles.value}>{floor}</BloomText>
                    </View>
                )}
                {yearBuilt && (
                    <View style={styles.item}>
                        <BloomText style={styles.label}>{t('Year Built') || 'Year Built'}</BloomText>
                        <BloomText style={styles.value}>{yearBuilt}</BloomText>
                    </View>
                )}
                {parkingSpaces !== undefined && (
                    <View style={styles.item}>
                        <BloomText style={styles.label}>{t('Parking Spaces') || 'Parking Spaces'}</BloomText>
                        <BloomText style={styles.value}>{parkingSpaces}</BloomText>
                    </View>
                )}
            </View>
        </Section>
    );
};

const styles = StyleSheet.create({
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        rowGap: spacing.lg,
    },
    item: { width: '50%' },
    label: { fontSize: 14, color: colors.COLOR_BLACK_LIGHT_3, marginBottom: spacing.xs },
    value: { fontSize: 16, fontWeight: '600', color: colors.COLOR_BLACK },
});

export default PropertyDetailsCard;
