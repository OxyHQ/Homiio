import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { useTranslation } from 'react-i18next';

interface Stat { label: string; value: string | number; }
interface Props { property: any }

export const PropertyStatistics: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const stats: Stat[] = [
        { label: t('Bedrooms') || 'Bedrooms', value: property?.bedrooms ?? '-' },
        { label: t('Bathrooms') || 'Bathrooms', value: property?.bathrooms ?? '-' },
        { label: t('Size') || 'Size', value: property?.size ? `${property.size}m²` : '-' },
        ...(property?.floor !== undefined ? [{ label: t('Floor') || 'Floor', value: property.floor }] : []),
    ];
    return (
        <View style={styles.container}>
            <ThemedText style={styles.sectionTitle}>{t('Statistics')}</ThemedText>
            <View style={styles.card}>
                {stats.map((s, idx) => (
                    <ThemedText key={idx} style={styles.item}>{s.label}: <ThemedText style={styles.value}>{s.value}</ThemedText></ThemedText>
                ))}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { marginBottom: 20 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
    card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e9ecef' },
    item: { fontSize: 14, marginBottom: 8 },
    value: { fontWeight: '600' },
});

export default PropertyStatistics;
