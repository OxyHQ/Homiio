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
import { getCurrencyByCode, Currency } from '@/utils/currency';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';

const CURRENCY_STORAGE_KEY = '@homiio_currency';

export const useCurrency = () => {
  const { currentCurrency, isLoading, error, setCurrentCurrency, setLoading, setError } =
    useCurrencyStore();

  // Load the saved currency once on mount. Inlined into the effect: it was a
  // `const` arrow declared BELOW this effect and called from inside it, so the
  // effect closed over whichever instance the first render happened to make.
  // It is used nowhere else and is not returned from the hook, so there is
  // nothing for it to be a named function for.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const savedCurrencyCode = await AsyncStorage.getItem(CURRENCY_STORAGE_KEY);
        if (!cancelled && savedCurrencyCode) {
          setCurrentCurrency(savedCurrencyCode);
        }
      } catch {
        if (!cancelled) setError('Failed to load saved currency');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setCurrentCurrency, setError, setLoading]);

  const changeCurrency = async (currencyCode: string) => {
    try {
      setLoading(true);
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
