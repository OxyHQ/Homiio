/**
 * Settings → Currency. Mirrors the Language screen pattern: Bloom
 * SettingsList primitives with a row per currency and an active-state
 * checkmark on the right.
 */
import { StyleSheet } from 'react-native';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { toast } from '@oxy.so/bloom/toast';

import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { RiCheckLine } from '@oxy.so/bloom/icons';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { useTheme } from '@oxy.so/bloom/theme';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';

import { useCurrency } from '@/hooks/useCurrency';
import { CURRENCIES, getExchangeRateDisplay } from '@/utils/currency';
import { useExchangeRates } from '@/utils/exchangeRates';
import { useFormatting } from '@/utils/format';
import { settingsScreenStyles } from '@/components/profile/SettingsRowIcon';

export default function CurrencySettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const rates = useExchangeRates();
  const { currentCurrency, changeCurrency } = useCurrency();
  const { locale } = useFormatting();
  const { colors: theme } = useTheme();

  const handleCurrencySelect = async (currencyCode: string): Promise<void> => {
    try {
      await changeCurrency(currencyCode);
      toast.success(t('settings.currency.currencyChanged'));
      router.back();
    } catch {
      toast.error(t('settings.currency.errorChanging'));
    }
  };

  return (
    <Screen
      documentScroll
      header={
        <PageHeader
          title={t('settings.currency.title')}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          onBack={router.canGoBack() ? router.back : undefined}
          backLabel={t('goBack')}
        />
      }
    >
      <ScreenScrollView contentContainerStyle={settingsScreenStyles.content}>
        <SettingsListGroup
          title={t('settings.currency.selectCurrency')}
          footer={t('settings.currency.description')}
        >
          {CURRENCIES.map((currency) => {
            const isActive = currentCurrency === currency.code;
            const exchangeRate =
              currency.code === currentCurrency
                ? undefined
                : getExchangeRateDisplay(currentCurrency, currency.code, locale, rates);
            const description = exchangeRate ? `${currency.code} · ${exchangeRate}` : currency.code;
            return (
              <SettingsListItem
                key={currency.code}
                icon={<Text style={styles.flag}>{currency.flag}</Text>}
                title={currency.name}
                description={description}
                value={currency.symbol}
                rightElement={
                  isActive ? <RiCheckLine width={20} height={20} fill={theme.primary} /> : undefined
                }
                showChevron={!isActive}
                onPress={() => handleCurrencySelect(currency.code)}
              />
            );
          })}
        </SettingsListGroup>
      </ScreenScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flag: {
    fontSize: 18,
    lineHeight: 20,
  },
});
