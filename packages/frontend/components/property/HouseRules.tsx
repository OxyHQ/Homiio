import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { useTranslation } from 'react-i18next';

interface Props { property: any }

export const HouseRules: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const petsAllowed = property?.rules?.petsAllowed;
    const smokingAllowed = property?.rules?.smokingAllowed;
    const partiesAllowed = property?.rules?.partiesAllowed;
    if (petsAllowed === undefined && smokingAllowed === undefined && partiesAllowed === undefined) return null;
    const yesNo = (v?: boolean) => v === undefined ? '-' : v ? t('Yes') : t('No');
    return (
        <View style={styles.container}>
            <ThemedText style={styles.sectionTitle}>{t('House Rules')}</ThemedText>
            <View style={styles.card}>
                {petsAllowed !== undefined && <ThemedText style={styles.item}>{t('Pets Allowed')}: <ThemedText style={styles.value}>{yesNo(petsAllowed)}</ThemedText></ThemedText>}
                {smokingAllowed !== undefined && <ThemedText style={styles.item}>{t('Smoking Allowed')}: <ThemedText style={styles.value}>{yesNo(smokingAllowed)}</ThemedText></ThemedText>}
                {partiesAllowed !== undefined && <ThemedText style={styles.item}>{t('Parties Allowed')}: <ThemedText style={styles.value}>{yesNo(partiesAllowed)}</ThemedText></ThemedText>}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { marginBottom: 20 },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
    card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e9ecef' },
    item: { fontSize: 14, marginBottom: 8 },
    value: { fontWeight: '600', color: colors.primaryColor },
});

export default HouseRules;
