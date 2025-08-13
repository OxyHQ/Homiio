import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCurrency } from '@/hooks/useCurrency';
import { colors } from '@/styles/colors';

// Type assertion for Ionicons compatibility with React 19
const IconComponent = Ionicons as any;

interface CurrencyConversionIndicatorProps {
  originalCurrency: string;
  originalAmount: number;
  showDetails?: boolean;
  onPress?: () => void;
  style?: any;
}

export const CurrencyConversionIndicator: React.FC<CurrencyConversionIndicatorProps> = ({
  originalCurrency,
  originalAmount,
  showDetails = false,
  onPress,
  style,
}) => {
  const { currentCurrency, convertAmount, getExchangeRateInfo } = useCurrency();

  // Don't show if currencies are the same
  if (originalCurrency === currentCurrency) {
    return null;
  }

  const convertedAmount = convertAmount(originalAmount, originalCurrency);
  const exchangeRateInfo = getExchangeRateInfo(originalCurrency);

  return (
    <TouchableOpacity style={[styles.container, style]} onPress={onPress} disabled={!onPress}>
      <View style={styles.content}>
        <IconComponent name="swap-horizontal" size={14} color={colors.primaryColor} />
        <Text style={styles.text}>Converted from {originalCurrency}</Text>
        {showDetails && <Text style={styles.rateText}>{exchangeRateInfo}</Text>}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.primaryLight,
    borderRadius: 8,
    padding: 8,
    marginVertical: 4,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  text: {
    fontSize: 12,
    color: colors.primaryColor,
    fontWeight: '500',
  },
  rateText: {
    fontSize: 11,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginLeft: 'auto',
  },
});
