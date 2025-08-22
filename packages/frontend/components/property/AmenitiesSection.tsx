import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { useTranslation } from 'react-i18next';

interface Props { property: any }

export const AmenitiesSection: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const amenities = property?.amenities;
    if (!amenities || amenities.length === 0) return null;
    return (
        <View style={styles.container}>
            <ThemedText style={styles.sectionTitle}>{t('Amenities')}</ThemedText>
            <View style={styles.card}>
                <View style={styles.badges}>
                    {amenities.map((a: string, idx: number) => (
                        <View key={idx} style={styles.badge}><ThemedText style={styles.badgeText}>{a}</ThemedText></View>
                    ))}
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { marginBottom: 20 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
    card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e9ecef' },
    badges: { flexDirection: 'row', flexWrap: 'wrap' },
    badge: { backgroundColor: '#f1f3f5', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, margin: 4 },
    badgeText: { fontSize: 12 },
});

export default AmenitiesSection;
