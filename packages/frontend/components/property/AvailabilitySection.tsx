import React from 'react';
import { StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { SectionCard } from '@/components/ui/SectionCard';
import { useTranslation } from 'react-i18next';

interface Props { property: any }

export const AvailabilitySection: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const availableFrom = property?.availableFrom || property?.createdAt;
    const leaseTerm = property?.leaseTerm;
    if (!availableFrom && !leaseTerm) return null;
    const dateStr = availableFrom ? new Date(availableFrom).toLocaleDateString() : undefined;
    return (
        <SectionCard title={t('Availability')}>
            {dateStr && <ThemedText style={styles.item}>{t('Available From')}: {dateStr}</ThemedText>}
            {leaseTerm && <ThemedText style={styles.item}>{t('Lease Term')}: {leaseTerm}</ThemedText>}
        </SectionCard>
    );
};

const styles = StyleSheet.create({
    item: { fontSize: 14, marginBottom: 8 },
});

export default AvailabilitySection;
