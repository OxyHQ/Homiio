import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    StyleSheet,
    Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { useCurrency } from '@/hooks/useCurrency';
import { CURRENCIES, getExchangeRateDisplay } from '@/utils/currency';

// Type assertion for Ionicons compatibility with React 19
const IconComponent = Ionicons as any;

export default function CurrencySettingsScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { currentCurrency, changeCurrency } = useCurrency();
    const [selectedCurrency, setSelectedCurrency] = useState(currentCurrency.code);

    useEffect(() => {
        setSelectedCurrency(currentCurrency.code);
    }, [currentCurrency.code]);

    const handleCurrencySelect = async (currencyCode: string) => {
        setSelectedCurrency(currencyCode);

        try {
            await changeCurrency(currencyCode);

            Alert.alert(
                t('common.success'),
                t('settings.currency.currencyChanged', 'Currency changed successfully'),
                [
                    {
                        text: t('common.ok'),
                        onPress: () => router.back(),
                    },
                ]
            );
        } catch (error) {
            Alert.alert(
                t('common.error'),
                t('settings.currency.errorChanging', 'Failed to change currency. Please try again.'),
                [{ text: t('common.ok') }]
            );
        }
    };

    const getExchangeRateInfo = (currencyCode: string) => {
        if (currencyCode === currentCurrency.code) {
            return null;
        }
        return getExchangeRateDisplay(currentCurrency.code, currencyCode);
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <IconComponent name="arrow-back" size={22} color="#000" />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle}>{t('settings.currency.title', 'Currency')}</Text>
                </View>
            </View>

            <ScrollView style={styles.content}>
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>
                        {t('settings.currency.selectCurrency', 'Select your preferred currency')}
                    </Text>
                    <Text style={styles.sectionDescription}>
                        {t('settings.currency.description', 'This will be used to display prices throughout the app. Exchange rates are approximate.')}
                    </Text>
                </View>

                <View style={styles.groupedList}>
                    {CURRENCIES.map((currency, idx) => {
                        let itemStyle: any = [styles.settingItem];
                        if (idx === 0) {
                            itemStyle.push(styles.firstSettingItem);
                        } else if (idx === CURRENCIES.length - 1) {
                            itemStyle.push(styles.lastSettingItem);
                        }
                        if (selectedCurrency === currency.code) {
                            itemStyle.push({ backgroundColor: '#f0f8ff' });
                        }

                        const exchangeRateInfo = getExchangeRateInfo(currency.code);

                        return (
                            <TouchableOpacity
                                key={currency.code}
                                style={itemStyle}
                                onPress={() => handleCurrencySelect(currency.code)}
                            >
                                <View style={styles.settingInfo}>
                                    <Text style={styles.currencyFlag}>{currency.flag}</Text>
                                    <View style={styles.currencyInfo}>
                                        <Text style={styles.currencyName}>{currency.name}</Text>
                                        <Text style={styles.currencyCode}>{currency.code}</Text>
                                        {exchangeRateInfo && (
                                            <Text style={styles.exchangeRate}>{exchangeRateInfo}</Text>
                                        )}
                                    </View>
                                    <Text style={styles.currencySymbol}>{currency.symbol}</Text>
                                </View>
                                {selectedCurrency === currency.code && (
                                    <IconComponent name="checkmark" size={20} color={colors.primaryColor} />
                                )}
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f2f2f2',
    },
    header: {
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 16,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        flexDirection: 'row',
        alignItems: 'center',
    },
    backButton: {
        position: 'absolute',
        left: 20,
        top: 20,
        zIndex: 2,
        padding: 4,
    },
    headerTitleContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#000',
    },
    content: {
        flex: 1,
        padding: 16,
    },
    section: {
        marginBottom: 24,
        paddingTop: 0,
        paddingBottom: 0,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 8,
    },
    sectionDescription: {
        fontSize: 14,
        color: '#666',
        lineHeight: 20,
    },
    groupedList: {
        backgroundColor: '#fff',
        borderRadius: 24,
        overflow: 'hidden',
        marginTop: 0,
        marginBottom: 0,
        paddingTop: 0,
        paddingBottom: 0,
    },
    settingItem: {
        backgroundColor: '#fff',
        paddingVertical: 16,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 2,
    },
    firstSettingItem: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        marginBottom: 2,
    },
    lastSettingItem: {
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        marginBottom: 0,
    },
    settingInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    currencyFlag: {
        fontSize: 24,
        marginRight: 12,
    },
    currencyInfo: {
        flex: 1,
    },
    currencyName: {
        fontSize: 16,
        fontWeight: '500',
        color: '#333',
        marginBottom: 2,
    },
    currencyCode: {
        fontSize: 14,
        color: '#666',
    },
    currencySymbol: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginLeft: 8,
    },
    exchangeRate: {
        fontSize: 12,
        color: '#999',
        marginTop: 2,
    },
}); 