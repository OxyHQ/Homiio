import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { useTranslation } from 'react-i18next';

interface Props { property: any }

export const PropertyDetailsCard: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const type = property?.type;
    const floor = property?.floor;
    const yearBuilt = property?.yearBuilt;
    const parkingSpaces = property?.parkingSpaces;
    return (
        <View style={styles.container}>
            <ThemedText style={styles.sectionTitle}>{t('Property Details') || 'Property Details'}</ThemedText>
            <View style={styles.card}>
                <View style={styles.row}>
                    <View style={styles.item}>
                        <ThemedText style={styles.label}>{t('Property Type') || 'Property Type'}</ThemedText>
                        <ThemedText style={styles.value}>{type ? type.charAt(0).toUpperCase() + type.slice(1) : t('Not specified') || 'Not specified'}</ThemedText>
                    </View>
                    {floor !== undefined && (
                        <View style={styles.item}>
                            <ThemedText style={styles.label}>{t('Floor') || 'Floor'}</ThemedText>
                            <ThemedText style={styles.value}>{floor}</ThemedText>
                        </View>
                    )}
                </View>
                <View style={styles.row}>
                    {yearBuilt && (
                        <View style={styles.item}>
                            <ThemedText style={styles.label}>{t('Year Built') || 'Year Built'}</ThemedText>
                            <ThemedText style={styles.value}>{yearBuilt}</ThemedText>
                        </View>
                    )}
                    {parkingSpaces !== undefined && (
                        <View style={styles.item}>
                            <ThemedText style={styles.label}>{t('Parking Spaces') || 'Parking Spaces'}</ThemedText>
                            <ThemedText style={styles.value}>{parkingSpaces}</ThemedText>
                        </View>
                    )}
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { marginBottom: 20 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
    card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e9ecef', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
    row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    item: { flex: 1 },
    label: { fontSize: 14, color: colors.COLOR_BLACK_LIGHT_3, marginBottom: 5 },
    value: { fontSize: 16, fontWeight: 'bold', color: colors.COLOR_BLACK },
});

export default PropertyDetailsCard;
