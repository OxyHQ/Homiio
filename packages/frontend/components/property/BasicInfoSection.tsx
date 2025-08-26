/* Auto-generated extraction from PropertyDetailPage */
import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { CurrencyFormatter } from '@/components/CurrencyFormatter';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

interface Props {
    property: any; // unified property object
    hasActiveViewing: boolean;
    onViewingsPress: () => void;
}

export const BasicInfoSection: React.FC<Props> = ({ property, hasActiveViewing, onViewingsPress }) => {
    const { t } = useTranslation();
    const priceUnit: Props['property']['priceUnit'] = property?.priceUnit || 'month';
    const rentAmount = property?.rent?.amount ?? 0;
    const rentCurrency = property?.rent?.currency || 'USD';
    const description = property?.description;
    const getRentLabel = (unit: typeof priceUnit) => {
        switch (unit) {
            case 'day': return t('Daily Rent');
            case 'night': return t('Nightly Rent');
            case 'week': return t('Weekly Rent');
            case 'month': return t('Monthly Rent');
            case 'year': return t('Yearly Rent');
            default: return t('Rent');
        }
    };
    return (
        <View style={styles.container}>
            <View style={styles.priceContainer}>
                <ThemedText style={styles.priceLabel}>{getRentLabel(priceUnit)}</ThemedText>
                <CurrencyFormatter amount={rentAmount} originalCurrency={rentCurrency} showConversion />
            </View>

            {/* External Source Badge */}
            {property?.isExternal && property?.source && property.source !== 'internal' && (
                <View style={styles.sourceBadgeContainer}>
                    <View style={styles.sourceBadge}>
                        <Ionicons name="globe-outline" size={16} color={colors.primaryColor} />
                        <ThemedText style={styles.sourceBadgeText}>
                            {t('Sourced from')} {property.source.charAt(0).toUpperCase() + property.source.slice(1)}
                        </ThemedText>
                    </View>
                </View>
            )}

            {!!description && description.trim() !== '' && (
                <View style={styles.descriptionContainer}>
                    <ThemedText style={styles.sectionTitle}>{t('About this property')}</ThemedText>
                    <View style={styles.descriptionCard}>
                        <ThemedText style={styles.descriptionText}>{description}</ThemedText>
                    </View>
                </View>
            )}
            {hasActiveViewing && (
                <View style={styles.viewingBanner}>
                    <View style={styles.viewingBannerContent}>
                        <Ionicons name="calendar" size={20} color={colors.primaryColor} />
                        <ThemedText style={styles.viewingBannerText}>
                            {t('viewings.banner.hasViewing')}
                        </ThemedText>
                        <TouchableOpacity style={styles.viewingBannerButton} onPress={onViewingsPress}>
                            <ThemedText style={styles.viewingBannerButtonText}>
                                {t('viewings.banner.viewDetails')}
                            </ThemedText>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { marginBottom: 20 },
    priceContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    priceLabel: { fontSize: 16, color: colors.COLOR_BLACK_LIGHT_3 },
    sourceBadgeContainer: { marginBottom: 16 },
    sourceBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f8f9fa',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e9ecef',
        alignSelf: 'flex-start',
    },
    sourceBadgeText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginLeft: 6,
        fontWeight: '500',
    },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
    descriptionContainer: { marginBottom: 20 },
    descriptionCard: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e9ecef', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
    descriptionText: { fontSize: 15, lineHeight: 22, color: colors.COLOR_BLACK, textAlign: 'justify' },
    viewingBanner: { width: '100%', backgroundColor: '#EBF5FF', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: '#BFDBFE' },
    viewingBannerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    viewingBannerText: { flex: 1, fontSize: 14, color: colors.COLOR_BLACK, marginLeft: 8 },
    viewingBannerButton: { backgroundColor: colors.primaryColor, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
    viewingBannerButtonText: { color: '#fff', fontSize: 13, fontWeight: '500' },
});

export default BasicInfoSection;
