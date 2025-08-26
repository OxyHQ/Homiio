import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { SectionCard } from '@/components/ui/SectionCard';
import { useTranslation } from 'react-i18next';

interface Props { property: any }

export const AmenitiesSection: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const amenities = property?.amenities;
    if (!amenities || amenities.length === 0) return null;
    return (
        <SectionCard title={t('Amenities')}>
            <View style={styles.badges}>
                {amenities.map((a: string, idx: number) => (
                    <View key={idx} style={styles.badge}><ThemedText style={styles.badgeText}>{a}</ThemedText></View>
                ))}
            </View>
        </SectionCard>
    );
};

const styles = StyleSheet.create({
    badges: { flexDirection: 'row', flexWrap: 'wrap' },
    badge: { backgroundColor: '#f1f3f5', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, margin: 4 },
    badgeText: { fontSize: 12 },
});

export default AmenitiesSection;
