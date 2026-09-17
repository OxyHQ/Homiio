/**
 * PriceBreakdown — a short-stay quote (nights × rate, fees, taxes, total) drawn
 * with Bloom's `PriceBreakdown`.
 *
 * Homiio owns the arithmetic and the money formatting (the listing's currency,
 * the reader's locale, always cents); Bloom owns the rows. The same quote feeds
 * the booking card on a listing, the reservation detail and the host's nightly
 * pricing preview, so all three read one total.
 */
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import {
  PriceBreakdown as BloomPriceBreakdown,
  type PriceBreakdownProps as BloomPriceBreakdownProps,
} from '@oxy.so/bloom/booking';
import { formatMoney } from '@homiio/shared-types';
import { useFormatting } from '@/utils/format';

/** A price breakdown always shows cents, so fix precision at 2 fraction digits. */
const MONEY_FORMAT = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

export interface StayQuoteInput {
  nights: number;
  nightlyRate: number;
  cleaningFee?: number;
  serviceFee?: number;
  /** Percentage 0-100. Applied to (nightly * nights + cleaningFee + serviceFee). */
  taxesPercent?: number;
}

export interface StayQuote {
  nights: number;
  nightlyRate: number;
  subtotal: number;
  cleaningFee: number;
  serviceFee: number;
  taxes: number;
  total: number;
}

/** The quote's amounts. Negative inputs count as zero; taxes and total round to cents. */
export function computeStayQuote({
  nights,
  nightlyRate,
  cleaningFee = 0,
  serviceFee = 0,
  taxesPercent = 0,
}: StayQuoteInput): StayQuote {
  const safeNights = Math.max(0, Math.floor(nights));
  const safeRate = Math.max(0, nightlyRate);
  const subtotal = safeNights * safeRate;
  const cleaning = Math.max(0, cleaningFee);
  const service = Math.max(0, serviceFee);
  const taxableBase = subtotal + cleaning + service;
  const taxes = Math.round(taxableBase * (Math.max(0, taxesPercent) / 100) * 100) / 100;
  const total = Math.round((taxableBase + taxes) * 100) / 100;
  return {
    nights: safeNights,
    nightlyRate: safeRate,
    subtotal,
    cleaningFee: cleaning,
    serviceFee: service,
    taxes,
    total,
  };
}

/**
 * The Bloom `PriceBreakdown` props for a quote, or `null` while no night is
 * selected (there is nothing to itemise yet).
 */
export function useStayQuoteBreakdown(
  input: StayQuoteInput & { currency: string },
): BloomPriceBreakdownProps | null {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const { nights, nightlyRate, cleaningFee, serviceFee, taxesPercent, currency } = input;

  return useMemo(() => {
    const quote = computeStayQuote({ nights, nightlyRate, cleaningFee, serviceFee, taxesPercent });
    if (quote.nights === 0) return null;
    const money = (amount: number) => formatMoney(amount, currency, locale, MONEY_FORMAT);
    const rows: BloomPriceBreakdownProps['rows'] = [
      {
        key: 'nights',
        label: t('booking.breakdown.nights', {
          count: quote.nights,
          price: money(quote.nightlyRate),
        }),
        amount: money(quote.subtotal),
      },
    ];
    if (quote.cleaningFee > 0) {
      rows.push({
        key: 'cleaning',
        label: t('property.moveInCost.cleaningFee'),
        amount: money(quote.cleaningFee),
      });
    }
    if (quote.serviceFee > 0) {
      rows.push({
        key: 'service',
        label: t('property.moveInCost.serviceFee'),
        amount: money(quote.serviceFee),
      });
    }
    if (quote.taxes > 0) {
      rows.push({ key: 'taxes', label: t('property.moveInCost.taxes'), amount: money(quote.taxes) });
    }
    return { rows, totalLabel: t('booking.breakdown.total'), total: money(quote.total) };
  }, [nights, nightlyRate, cleaningFee, serviceFee, taxesPercent, currency, locale, t]);
}

export interface PriceBreakdownProps extends StayQuoteInput {
  currency: string;
}

export const PriceBreakdown: React.FC<PriceBreakdownProps> = (props) => {
  const { t } = useTranslation();
  const breakdown = useStayQuoteBreakdown(props);
  if (!breakdown) {
    return (
      <BloomText variant="body-2-regular" className="text-center text-muted-foreground">
        {t('booking.breakdown.selectDates')}
      </BloomText>
    );
  }
  return <BloomPriceBreakdown {...breakdown} />;
};

export default PriceBreakdown;
