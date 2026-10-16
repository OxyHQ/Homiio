/**
 * The user's chosen DISPLAY currency, for the settings picker.
 *
 * It used to also format and CONVERT: `formatAmount`, `convertAndFormat`,
 * `getCurrencySymbol` and friends turned every listing price into this currency
 * at an exchange rate with no timestamp, and defaulted to USD, so a fresh
 * install rendered European rents as approximate dollars. Issue #357 removed
 * that path — a listing's price is shown in the listing's own currency — so
 * everything except the preference itself is gone. Formatting lives in
 * `formatMoney` (`@homiio/shared-types`); the FX rate is quoted, explicitly and
 * only, on the picker screen.
 */
import { useCurrencyStore } from '@/store/currencyStore';
import { getCurrencyByCode, type Currency } from '@/utils/currency';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CURRENCY_STORAGE_KEY = '@homiio_currency';

/**
 * The saved currency is read from AsyncStorage ONCE, when this module loads,
 * straight into the store — not on every mount of a screen that shows it. A
 * choice made before the read lands is the newer one and is kept.
 */
let currencyChosen = false;
useCurrencyStore.getState().setLoading(true);
AsyncStorage.getItem(CURRENCY_STORAGE_KEY)
  .then((savedCurrencyCode) => {
    if (savedCurrencyCode && !currencyChosen) {
      useCurrencyStore.getState().setCurrentCurrency(savedCurrencyCode);
    }
  })
  .catch(() => {
    useCurrencyStore.getState().setError('Failed to load saved currency');
  })
  .finally(() => {
    useCurrencyStore.getState().setLoading(false);
  });

export const useCurrency = () => {
  const { currentCurrency, isLoading, error, setCurrentCurrency, setLoading, setError } =
    useCurrencyStore();

  const changeCurrency = async (currencyCode: string) => {
    try {
      setLoading(true);
      currencyChosen = true;
      setCurrentCurrency(currencyCode);
      await AsyncStorage.setItem(CURRENCY_STORAGE_KEY, currencyCode);
    } catch (error) {
      setError('Failed to save currency preference');
    } finally {
      setLoading(false);
    }
  };

  const getCurrentCurrency = (): Currency => {
    return (
      getCurrencyByCode(currentCurrency) || { code: currentCurrency, symbol: '$', name: 'Unknown' }
    );
  };

  return {
    currentCurrency,
    isLoading,
    error,
    changeCurrency,
    getCurrentCurrency,
  };
};
