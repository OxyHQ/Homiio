import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { Section } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import { useTranslation } from 'react-i18next';
import type { Property } from '@homiio/shared-types';

interface Props { property: Property | null }

export const HouseRules: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const petsAllowed = property?.rules?.petsAllowed;
    const smokingAllowed = property?.rules?.smokingAllowed;
    const partiesAllowed = property?.rules?.partiesAllowed;
    if (petsAllowed === undefined && smokingAllowed === undefined && partiesAllowed === undefined) return null;
    const yesNo = (v?: boolean) => v === undefined ? '-' : v ? t('propertyCreate.amenities.yes') : t('propertyCreate.amenities.no');
    return (
        <Section title={t('propertyCreate.amenities.houseRules')} bodyStyle={styles.body}>
            {petsAllowed !== undefined && (
                <View style={styles.row}>
                    <BloomText style={styles.label}>{t('propertyCreate.amenities.petsAllowed')}</BloomText>
                    <BloomText style={styles.value}>{yesNo(petsAllowed)}</BloomText>
                </View>
            )}
            {smokingAllowed !== undefined && (
                <View style={styles.row}>
                    <BloomText style={styles.label}>{t('propertyCreate.amenities.smokingAllowed')}</BloomText>
                    <BloomText style={styles.value}>{yesNo(smokingAllowed)}</BloomText>
                </View>
            )}
            {partiesAllowed !== undefined && (
                <View style={styles.row}>
                    <BloomText style={styles.label}>{t('propertyCreate.amenities.partiesAllowed')}</BloomText>
                    <BloomText style={styles.value}>{yesNo(partiesAllowed)}</BloomText>
                </View>
            )}
        </Section>
    );
};

const styles = StyleSheet.create({
    body: { gap: spacing.sm },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.lg,
    },
    label: { fontSize: 15, color: colors.COLOR_BLACK_LIGHT_3 },
    value: { fontSize: 15, fontWeight: '600', color: colors.COLOR_BLACK },
});

export default HouseRules;
