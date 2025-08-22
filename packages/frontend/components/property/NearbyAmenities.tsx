import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { useTranslation } from 'react-i18next';

interface Amenity { name: string; distance?: number; }
interface Props { property: any }

export const NearbyAmenities: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const amenities: Amenity[] = [
        property?.proximityToTransport ? { name: t('Public Transport') || 'Public Transport' } : null,
        property?.proximityToSchools ? { name: t('Schools') || 'Schools' } : null,
        property?.proximityToShopping ? { name: t('Shopping') || 'Shopping' } : null,
    ].filter(Boolean) as Amenity[];
    if (!amenities.length) return null;
    return (
        <View style={styles.container}>
            <ThemedText style={styles.sectionTitle}>{t('Nearby Amenities')}</ThemedText>
            <View style={styles.card}>
                {amenities.map((a, idx) => (
                    <ThemedText key={idx} style={styles.item}>• {a.name}{a.distance ? ` - ${a.distance}m` : ''}</ThemedText>
                ))}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { marginBottom: 20 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
    card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e9ecef' },
    item: { fontSize: 14, marginBottom: 4 },
});

export default NearbyAmenities;
