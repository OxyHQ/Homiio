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
        <Section title={t('property.sections.details')}>
            <View style={styles.grid}>
                <View style={styles.item}>
                    <BloomText style={styles.label}>{t('property.sections.propertyType')}</BloomText>
                    <BloomText style={styles.value}>{type ? type.charAt(0).toUpperCase() + type.slice(1) : t('property.sections.notSpecified')}</BloomText>
                </View>
                {floor !== undefined && (
                    <View style={styles.item}>
                        <BloomText style={styles.label}>{t('property.sections.floor')}</BloomText>
                        <BloomText style={styles.value}>{floor}</BloomText>
                    </View>
                )}
                {yearBuilt && (
                    <View style={styles.item}>
                        <BloomText style={styles.label}>{t('property.sections.yearBuilt')}</BloomText>
                        <BloomText style={styles.value}>{yearBuilt}</BloomText>
                    </View>
                )}
                {parkingSpaces !== undefined && (
                    <View style={styles.item}>
                        <BloomText style={styles.label}>{t('property.sections.parkingSpaces')}</BloomText>
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
