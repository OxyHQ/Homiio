import React from 'react';
import { TextProps } from 'react-native';

import { formatMoney, type CurrencyDisplay } from '@homiio/shared-types';

import { ThemedText } from './ThemedText';
import { useFormatting } from '@/utils/format';

/**
 * A money amount rendered in ITS OWN currency, for the reader's locale.
 *
 * Replaces `CurrencyFormatter`, whose name described what it actually did: it
 * converted every amount into the user's selected display currency through
 * `useCurrency().convertAndFormat`, using free-API rates with a bundled
 * `STALE_FALLBACK_RATES` table behind them. Since that preference defaults to
 * `USD`, a fresh install showed every European listing as a dollar figure
 * computed from an approximate rate carrying no timestamp — and the conversion
 * was invisible, because `PropertyCard` passed `showConversion={false}`.
 *
 * Issue #357 forbids exactly that ("no implicit currency conversion", "never
 * infer the currency from the locale"), so this component does not convert: the
 * currency it is given is the currency it prints. Converting a listing price
 * needs a rate and the timestamp it was taken at, which is a separate feature.
 */
export interface MoneyTextProps extends TextProps {
  amount: number;
  /** ISO 4217 code the `amount` is denominated in. */
  currency: string;
  /** `symbol` (default), `code`, or `name` for an accessibility label. */
  display?: CurrencyDisplay;
  /** Defaults to `0` — a whole rent reads `€1,700`, not `€1,700.00`. */
  minimumFractionDigits?: number;
  /** Defaults to `2`. */
  maximumFractionDigits?: number;
}

export const MoneyText: React.FC<MoneyTextProps> = ({
  amount,
  currency,
  display,
  minimumFractionDigits,
  maximumFractionDigits,
  style,
  ...textProps
}) => {
  const { locale } = useFormatting();
  return (
    <ThemedText style={style} {...textProps}>
      {formatMoney(amount, currency, locale, {
        currencyDisplay: display,
        minimumFractionDigits,
        maximumFractionDigits,
      })}
    </ThemedText>
  );
};
