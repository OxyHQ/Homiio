import React from 'react';
import { Text, TextProps } from 'react-native';
import { useCurrency } from '@/hooks/useCurrency';

interface CurrencyFormatterProps extends TextProps {
    amount: number;
    originalCurrency?: string; // The currency the amount is originally in
    showCode?: boolean;
    showSymbol?: boolean;
    showConversion?: boolean; // Show original amount in parentheses if different currency
    style?: any;
}

export const CurrencyFormatter: React.FC<CurrencyFormatterProps> = ({
    amount,
    originalCurrency,
    showCode = false,
    showSymbol = true,
    showConversion = true,
    style,
    ...textProps
}) => {
    const { formatAmount, convertAndFormat, getCurrencyCode } = useCurrency();
    const currentCurrencyCode = getCurrencyCode();

    const formatValue = () => {
        // If no original currency specified, assume it's in current currency
        if (!originalCurrency || originalCurrency === currentCurrencyCode) {
            if (showCode) {
                return formatAmount(amount, true);
            }

            if (!showSymbol) {
                return amount.toLocaleString('en-US', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                });
            }

            return formatAmount(amount);
        }

        // Convert from original currency to current currency
        const convertedAmount = convertAndFormat(amount, originalCurrency, showCode);

        if (showConversion) {
            // Show converted amount with original amount in parentheses
            const originalFormatted = formatAmount(amount, showCode);
            return `${convertedAmount} (${originalFormatted})`;
        }

        return convertedAmount;
    };

    return (
        <Text style={style} {...textProps}>
            {formatValue()}
        </Text>
    );
}; 