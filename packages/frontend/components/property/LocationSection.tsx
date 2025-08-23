import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import Map from '@/components/Map';
import { useTranslation } from 'react-i18next';

interface Props { property: any }

// Unified location section: address + map + nearby amenities
export const LocationSection: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const address = property?.address;
    const coords: any = property?.address?.coordinates?.coordinates;
    const hasAddress = address && (address.street || address.city || address.state || address.country);
    const hasMap = Array.isArray(coords) && coords.length === 2;
    const proximity = property?.proximity || {};
    const amenities: string[] = [];
    if (proximity.proximityToTransport) amenities.push(t('Public Transport'));
    if (proximity.proximityToSchools) amenities.push(t('Schools'));
    if (proximity.proximityToShopping) amenities.push(t('Shopping'));

    if (!hasAddress && !hasMap) return null;
    return (
        <View style={styles.container}>
            <ThemedText style={styles.sectionTitle}>{t('Location')}</ThemedText>
            {hasAddress && (
                <View style={styles.card}>
                    {address.street && <ThemedText style={styles.item}>{address.street}</ThemedText>}
                    <ThemedText style={styles.item}>
                        {[address.city, address.state, address.country].filter(Boolean).join(', ')}
                    </ThemedText>
                </View>
            )}
            {hasMap && (
                <View style={styles.mapWrapper}>
                    <Map
                        style={{ height: 200 }}
                        initialCoordinates={[coords[0], coords[1]]}
                        initialZoom={15}
                        screenId={`property-location-${property?._id || property?.id || 'unknown'}`}
                    />
                </View>
            )}
            {amenities.length > 0 && (
                <View style={styles.amenitiesCard}>
                    <ThemedText style={styles.amenitiesTitle}>{t('Nearby Amenities')}</ThemedText>
                    {amenities.map(a => (
                        <ThemedText key={a} style={styles.amenityItem}>• {a}</ThemedText>
                    ))}
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { marginBottom: 20 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
    card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e9ecef', marginBottom: 12 },
    item: { fontSize: 14, marginBottom: 8 },
    mapWrapper: { borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#e9ecef', marginBottom: 12 },
    amenitiesCard: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e9ecef' },
    amenitiesTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
    amenityItem: { fontSize: 14, marginBottom: 4 },
});

export default LocationSection;
