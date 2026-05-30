import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { Section } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import { useTranslation } from 'react-i18next';
import type { Property } from '@homiio/shared-types';

interface Props { property: Property | null }

export const AvailabilitySection: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const availableFrom = property?.availableFrom || property?.createdAt;
    const leaseTerm = property?.leaseTerm;
    if (!availableFrom && !leaseTerm) return null;
    const dateStr = availableFrom ? new Date(availableFrom).toLocaleDateString() : undefined;
    return (
        <Section title={t('Availability')} bodyStyle={styles.body}>
            {dateStr && (
                <View style={styles.row}>
                    <BloomText style={styles.label}>{t('Available From')}</BloomText>
                    <BloomText style={styles.value}>{dateStr}</BloomText>
                </View>
            )}
            {leaseTerm && (
                <View style={styles.row}>
                    <BloomText style={styles.label}>{t('Lease Term')}</BloomText>
                    <BloomText style={styles.value}>{leaseTerm}</BloomText>
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

export default AvailabilitySection;
