import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { useTranslation } from 'react-i18next';
import Map from '@/components/Map';

interface Props { property: any }

export const LocationDetails: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const city = property?.address?.city;
    const region = property?.address?.state;
    const country = property?.address?.country;
    const address = property?.address?.street;
    const coordinates: any = property?.address?.coordinates?.coordinates;
    if (!city && !region && !country && !address) return null;
    return (
        <View style={styles.container}>
            <ThemedText style={styles.sectionTitle}>{t('Location')}</ThemedText>
            <View style={styles.card}>
                {address && <ThemedText style={styles.item}>{address}</ThemedText>}
                <ThemedText style={styles.item}>{[city, region, country].filter(Boolean).join(', ')}</ThemedText>
            </View>
            {Array.isArray(coordinates) && coordinates.length === 2 && (
                <View style={styles.mapWrapper}>
                    <Map
                        style={{ height: 200 }}
                        initialCoordinates={[coordinates[0], coordinates[1]]}
                        initialZoom={15}
                        screenId={`property-location-${property?._id || property?.id || 'unknown'}`}
                    />
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
    mapWrapper: { borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#e9ecef' },
});

export default LocationDetails;
