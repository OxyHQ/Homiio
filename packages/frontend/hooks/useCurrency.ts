import { useCurrencyStore } from '@/store/currencyStore';
import { 
    getCurrencyByCode, 
    formatCurrency, 
    formatCurrencyWithCode, 
    convertCurrency,
    formatAmountInCurrency,
    getExchangeRateDisplay,
    Currency 
} from '@/utils/currency';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';

const CURRENCY_STORAGE_KEY = '@homiio_currency';

export const useCurrency = () => {
  const { currentCurrency, isLoading, error, setCurrentCurrency, setLoading, setError } = useCurrencyStore();

  // Load saved currency on app start
  useEffect(() => {
    loadSavedCurrency();
  }, []);

  const loadSavedCurrency = async () => {
    try {
      setLoading(true);
      const savedCurrencyCode = await AsyncStorage.getItem(CURRENCY_STORAGE_KEY);
      if (savedCurrencyCode) {
        setCurrentCurrency(savedCurrencyCode);
      }
    } catch (error) {
      console.error('Failed to load saved currency:', error);
      setError('Failed to load saved currency');
    } finally {
      setLoading(false);
    }
  };

  const changeCurrency = async (currencyCode: string) => {
    try {
      setLoading(true);
      setCurrentCurrency(currencyCode);
      await AsyncStorage.setItem(CURRENCY_STORAGE_KEY, currencyCode);
    } catch (error) {
      console.error('Failed to save currency preference:', error);
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
    showCode: boolean = false
  ): string => {
    const convertedAmount = convertCurrency(amount, originalCurrency, currentCurrency);
    return formatAmount(convertedAmount, showCode);
  };

  const getCurrentCurrency = (): Currency => {
    return getCurrencyByCode(currentCurrency) || { code: currentCurrency, symbol: '$', name: 'Unknown' };
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