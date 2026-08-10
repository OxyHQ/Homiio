import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { Section } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@homiio/shared-types';
import { useFormatting } from '@/utils/format';
import type { Property } from '@homiio/shared-types';

interface Props { property: Property | null }

export const AvailabilitySection: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const { locale } = useFormatting();
    const availableFrom = property?.availableFrom || property?.createdAt;
    const leaseTerm = property?.leaseTerm;
    if (!availableFrom && !leaseTerm) return null;
    // A move-in date is a CIVIL date: it is the same day everywhere, so it is
    // rendered zone-independently (see `formatDate`) rather than being pushed
    // through `new Date()`, which reads a bare `YYYY-MM-DD` as UTC midnight and
    // shows the day before to every reader west of Greenwich.
    const dateStr = availableFrom ? formatDate(availableFrom, locale, 'UTC') : undefined;
    return (
        <Section title={t('property.sections.availability')} bodyStyle={styles.body}>
            {dateStr && (
                <View style={styles.row}>
                    <BloomText style={styles.label}>{t('property.sections.availableFrom')}</BloomText>
                    <BloomText style={styles.value}>{dateStr}</BloomText>
                </View>
            )}
            {leaseTerm && (
                <View style={styles.row}>
                    <BloomText style={styles.label}>{t('property.sections.leaseTerm')}</BloomText>
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
