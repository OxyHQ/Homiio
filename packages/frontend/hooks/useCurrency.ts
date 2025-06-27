import { useSelector, useDispatch } from 'react-redux';
import { RootState, AppDispatch } from '@/store/store';
import { setCurrency, setCurrencyByCode } from '@/store/reducers/currencyReducer';
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
  const dispatch = useDispatch<AppDispatch>();
  const { currentCurrency, isLoading, error } = useSelector((state: RootState) => state.currency);

  // Load saved currency on app start
  useEffect(() => {
    loadSavedCurrency();
  }, []);

  const loadSavedCurrency = async () => {
    try {
      const savedCurrencyCode = await AsyncStorage.getItem(CURRENCY_STORAGE_KEY);
      if (savedCurrencyCode) {
        const currency = getCurrencyByCode(savedCurrencyCode);
        if (currency) {
          dispatch(setCurrency(currency));
        }
      }
    } catch (error) {
      console.error('Failed to load saved currency:', error);
    }
  };

  const changeCurrency = async (currencyCode: string) => {
    try {
      const currency = getCurrencyByCode(currencyCode);
      if (currency) {
        dispatch(setCurrency(currency));
        await AsyncStorage.setItem(CURRENCY_STORAGE_KEY, currencyCode);
      }
    } catch (error) {
      console.error('Failed to save currency preference:', error);
    }
  };

  const formatAmount = (amount: number, showCode: boolean = false): string => {
    if (showCode) {
      return formatCurrencyWithCode(amount, currentCurrency.code);
    }
    return formatCurrency(amount, currentCurrency.code);
  };

  const convertAndFormat = (
    amount: number, 
    originalCurrency: string, 
    showCode: boolean = false
  ): string => {
    const convertedAmount = convertCurrency(amount, originalCurrency, currentCurrency.code);
    return formatAmount(convertedAmount, showCode);
  };

  const getCurrentCurrency = (): Currency => {
    return currentCurrency;
  };

  const getCurrencySymbol = (): string => {
    return currentCurrency.symbol;
  };

  const getCurrencyCode = (): string => {
    return currentCurrency.code;
  };

  const getExchangeRateInfo = (fromCurrency: string): string => {
    return getExchangeRateDisplay(fromCurrency, currentCurrency.code);
  };

  const convertAmount = (amount: number, fromCurrency: string): number => {
    return convertCurrency(amount, fromCurrency, currentCurrency.code);
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