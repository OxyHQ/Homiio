import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { useTranslation } from 'react-i18next';

interface Props { property: any }

export const AvailabilitySection: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const availableFrom = property?.availableFrom || property?.createdAt;
    const leaseTerm = property?.leaseTerm;
    if (!availableFrom && !leaseTerm) return null;
    const dateStr = availableFrom ? new Date(availableFrom).toLocaleDateString() : undefined;
    return (
        <View style={styles.container}>
            <ThemedText style={styles.sectionTitle}>{t('Availability')}</ThemedText>
            <View style={styles.card}>
                {dateStr && <ThemedText style={styles.item}>{t('Available From')}: {dateStr}</ThemedText>}
                {leaseTerm && <ThemedText style={styles.item}>{t('Lease Term')}: {leaseTerm}</ThemedText>}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { marginBottom: 20 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
    card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e9ecef' },
    item: { fontSize: 14, marginBottom: 8 },
});

export default AvailabilitySection;
