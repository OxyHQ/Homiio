import { useCurrencyStore } from '@/store/currencyStore';
import {
  getCurrencyByCode,
  formatCurrency,
  formatCurrencyWithCode,
  convertCurrency,
  getExchangeRateDisplay,
  Currency,
} from '@/utils/currency';
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

  const formatAmount = (amount: number, showCode: boolean = false): string => {
    if (showCode) {
      return formatCurrencyWithCode(amount, currentCurrency);
    }
    return formatCurrency(amount, currentCurrency);
  };

  const convertAndFormat = (
    amount: number,
    originalCurrency: string,
    showCode: boolean = false,
  ): string => {
    const convertedAmount = convertCurrency(amount, originalCurrency, currentCurrency);
    return formatAmount(convertedAmount, showCode);
  };

  const getCurrentCurrency = (): Currency => {
    return (
      getCurrencyByCode(currentCurrency) || { code: currentCurrency, symbol: '$', name: 'Unknown' }
    );
  };

  const getCurrencySymbol = (): string => {
    const currency = getCurrencyByCode(currentCurrency);
    return currency?.symbol || '$';
  };

  const getCurrencyCode = (): string => {
    return currentCurrency;
  };

  const getExchangeRateInfo = (fromCurrency: string): string => {
    return getExchangeRateDisplay(fromCurrency, currentCurrency);
  };

  const convertAmount = (amount: number, fromCurrency: string): number => {
    return convertCurrency(amount, fromCurrency, currentCurrency);
  };

  return {
    currentCurrency,
    isLoading,
    error,
    changeCurrency,
    formatAmount,
    convertAndFormat,
    getCurrentCurrency,
    getCurrencySymbol,
    getCurrencyCode,
    getExchangeRateInfo,
    convertAmount,
  };
};
