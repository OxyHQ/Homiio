import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { useTranslation } from 'react-i18next';

interface Props { property: any }

export const PricingDetails: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const rentAmount = property?.rent?.amount;
    const rentFrequency = property?.priceUnit || property?.rent?.paymentFrequency;
    const deposit = property?.rent?.deposit;
    const utilitiesIncluded = property?.rent?.utilities === 'included';
    if (rentAmount === undefined && deposit === undefined && utilitiesIncluded === undefined) return null;
    return (
        <View style={styles.container}>
            <ThemedText style={styles.sectionTitle}>{t('Pricing & Costs')}</ThemedText>
            <View style={styles.card}>
                {rentAmount !== undefined && (
                    <ThemedText style={styles.item}>{t('Rent')}: <ThemedText style={styles.value}>${rentAmount}{rentFrequency ? `/${rentFrequency}` : ''}</ThemedText></ThemedText>
                )}
                {deposit !== undefined && (
                    <ThemedText style={styles.item}>{t('Deposit')}: <ThemedText style={styles.value}>${deposit}</ThemedText></ThemedText>
                )}
                {utilitiesIncluded !== undefined && (
                    <ThemedText style={styles.item}>{t('Utilities Included')}: <ThemedText style={styles.value}>{utilitiesIncluded ? t('Yes') : t('No')}</ThemedText></ThemedText>
                )}
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

export default PricingDetails;
