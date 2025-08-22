import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

interface Props { property: any }

export const PropertyFeatures: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const furnishedStatus = property?.furnishedStatus;
    const hasBalcony = property?.hasBalcony;
    const hasGarden = property?.hasGarden;
    const hasElevator = property?.hasElevator;
    if (furnishedStatus === undefined && hasBalcony === undefined && hasGarden === undefined && hasElevator === undefined) return null;
    const icon = (active: boolean) => ({ name: (active ? 'checkmark-circle' : 'close-circle') as any, color: active ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4 });
    return (
        <View style={styles.container}>
            <ThemedText style={styles.sectionTitle}>{t('Property Features')}</ThemedText>
            <View style={styles.card}>
                <View style={styles.grid}>
                    {furnishedStatus !== undefined && (
                        <View style={styles.item}>
                            <Ionicons {...icon(furnishedStatus === 'furnished')} size={20} />
                            <ThemedText style={styles.text}>{furnishedStatus === 'furnished' ? t('Furnished') : furnishedStatus === 'partially_furnished' ? t('Partially Furnished') : t('Unfurnished')}</ThemedText>
                        </View>)}
                    {hasBalcony !== undefined && (<View style={styles.item}><Ionicons {...icon(!!hasBalcony)} size={20} /><ThemedText style={styles.text}>{t('Balcony')}</ThemedText></View>)}
                    {hasGarden !== undefined && (<View style={styles.item}><Ionicons {...icon(!!hasGarden)} size={20} /><ThemedText style={styles.text}>{t('Garden')}</ThemedText></View>)}
                    {hasElevator !== undefined && (<View style={styles.item}><Ionicons {...icon(!!hasElevator)} size={20} /><ThemedText style={styles.text}>{t('Elevator')}</ThemedText></View>)}
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { marginBottom: 20 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
    card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e9ecef', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
    grid: { flexDirection: 'row', justifyContent: 'space-around', flexWrap: 'wrap' },
    item: { alignItems: 'center', marginVertical: 10 },
    text: { fontSize: 14, color: colors.COLOR_BLACK_LIGHT_3, marginTop: 5 },
});

export default PropertyFeatures;
