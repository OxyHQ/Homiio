import React from 'react';
import { StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { SectionCard } from '@/components/ui/SectionCard';
import { useTranslation } from 'react-i18next';

interface Stat {
    label: string;
    value: string | number;
}

interface Props {
    property: any
}

export const PropertyOverview: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const stats: Stat[] = [
        { label: t('Bedrooms') || 'Bedrooms', value: property?.bedrooms ?? '-' },
        { label: t('Bathrooms') || 'Bathrooms', value: property?.bathrooms ?? '-' },
        { label: t('Size') || 'Size', value: property?.size ? `${property.size}m²` : '-' },
        ...(property?.floor !== undefined ? [{ label: t('Floor') || 'Floor', value: property.floor }] : []),
    ];

    return (
        <SectionCard title={t('Property Overview')}>
            {stats.map((s, idx) => (
                <ThemedText key={idx} style={styles.item}>
                    {s.label}: <ThemedText style={styles.value}>{s.value}</ThemedText>
                </ThemedText>
            ))}
        </SectionCard>
    );
};

const styles = StyleSheet.create({
    item: { fontSize: 14, marginBottom: 8 },
    value: { fontWeight: '600' },
});

export default PropertyOverview;
