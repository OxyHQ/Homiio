/**
 * Settings → Currency. Mirrors the Language screen pattern: Bloom
 * SettingsList primitives with a row per currency and an active-state
 * checkmark on the right.
 */
import React, { useState, useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { toast } from 'sonner';

import {
  SettingsListGroup,
  SettingsListItem,
} from '@oxyhq/bloom/settings-list';

import { Header } from '@/components/Header';
import { useCurrency } from '@/hooks/useCurrency';
import { CURRENCIES, getExchangeRateDisplay } from '@/utils/currency';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

export default function CurrencySettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentCurrency, changeCurrency } = useCurrency();
  const [selectedCurrency, setSelectedCurrency] = useState(currentCurrency);

  useEffect(() => {
    setSelectedCurrency(currentCurrency);
  }, [currentCurrency]);

  const handleCurrencySelect = async (currencyCode: string): Promise<void> => {
    setSelectedCurrency(currencyCode);
    try {
      await changeCurrency(currencyCode);
      toast.success(
        t('settings.currency.currencyChanged', 'Currency changed successfully'),
      );
      router.back();
    } catch {
      toast.error(
        t('settings.currency.errorChanging', 'Failed to change currency. Please try again.'),
      );
    }
  };

  return (
    <View style={styles.root}>
      <Header
        options={{
          title: t('settings.currency.title', 'Currency'),
          showBackButton: true,
          titlePosition: 'center',
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <SettingsListGroup
          title={t('settings.currency.selectCurrency', 'Select your preferred currency')}
          footer={t(
            'settings.currency.description',
            'This will be used to display prices throughout the app. Exchange rates are approximate.',
          )}
        >
          {CURRENCIES.map((currency) => {
            const isActive = selectedCurrency === currency.code;
            const exchangeRate =
              currency.code === currentCurrency
                ? undefined
                : getExchangeRateDisplay(currentCurrency, currency.code);
            const description = exchangeRate
              ? `${currency.code} · ${exchangeRate}`
              : currency.code;
            return (
              <SettingsListItem
                key={currency.code}
                icon={<Text style={styles.flag}>{currency.flag}</Text>}
                title={currency.name}
                description={description}
                value={currency.symbol}
                rightElement={
                  isActive ? (
                    <Ionicons
                      name="checkmark"
                      size={20}
                      color={colors.primaryColor}
                    />
                  ) : undefined
                }
                showChevron={!isActive}
                onPress={() => handleCurrencySelect(currency.code)}
              />
            );
          })}
        </SettingsListGroup>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  flag: {
    fontSize: 18,
    lineHeight: 20,
  },
});
