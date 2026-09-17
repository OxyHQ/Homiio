/**
 * Settings → Currency. Mirrors the Language screen pattern: Bloom
 * SettingsList primitives with a row per currency and an active-state
 * checkmark on the right.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { toast } from '@oxy.so/bloom/toast';

import { RiCheckLine } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import {
  SettingsListGroup,
  SettingsListItem,
} from '@oxy.so/bloom/settings-list';

import { Header } from '@/components/Header';
import { useCurrency } from '@/hooks/useCurrency';
import { CURRENCIES, getExchangeRateDisplay } from '@/utils/currency';
import { useFormatting } from '@/utils/format';
import { settingsScreenStyles } from '@/components/profile/SettingsRowIcon';

export default function CurrencySettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentCurrency, changeCurrency } = useCurrency();
  const { locale } = useFormatting();
  const { colors: theme } = useTheme();

  const handleCurrencySelect = async (currencyCode: string): Promise<void> => {
    try {
      await changeCurrency(currencyCode);
      toast.success(
        t('settings.currency.currencyChanged'),
      );
      router.back();
    } catch {
      toast.error(
        t('settings.currency.errorChanging'),
      );
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Header
        options={{
          title: t('settings.currency.title'),
          showBackButton: true,
        }}
      />
      <ScrollView contentContainerStyle={settingsScreenStyles.content}>
        <SettingsListGroup
          title={t('settings.currency.selectCurrency')}
          footer={t('settings.currency.description')}
        >
          {CURRENCIES.map((currency) => {
            const isActive = currentCurrency === currency.code;
            const exchangeRate =
              currency.code === currentCurrency
                ? undefined
                : getExchangeRateDisplay(currentCurrency, currency.code, locale);
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
                    <RiCheckLine width={20} height={20} fill={theme.primary} />
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
  },
  flag: {
    fontSize: 18,
    lineHeight: 20,
  },
});
