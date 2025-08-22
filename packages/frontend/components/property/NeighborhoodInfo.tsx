import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { useTranslation } from 'react-i18next';

interface Props { property: any }

export const NeighborhoodInfo: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const description = t('This neighborhood offers excellent connectivity with public transportation, shopping centers, and educational institutions within walking distance.') || property?.neighborhoodDescription;
    return (
        <View style={styles.container}>
            <ThemedText style={styles.sectionTitle}>{t('Neighborhood')}</ThemedText>
            <View style={styles.card}>
                <ThemedText style={styles.item}>{description}</ThemedText>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { marginBottom: 20 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
    card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e9ecef' },
    item: { fontSize: 14 },
});

export default NeighborhoodInfo;
