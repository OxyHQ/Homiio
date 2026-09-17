/**
 * MortgageCalculatorSection — the affordability estimator on a sale listing, on
 * Bloom's `listing-actions` `MortgageCalculator`.
 *
 * Bloom owns the inputs (price, down payment as an amount and a percent with its
 * slider, term chips, rate), the annuity maths (`computeMortgage`) and the
 * result (monthly payment, principal / interest donut, loan, interest, total
 * cost). Homiio owns three things only:
 *
 *  - the listing's asking price as the starting price,
 *  - the baseline assumptions, from the one shared `DEFAULT_MORTGAGE_CONFIG` so
 *    the frontend and backend never disagree (its rate is a FRACTION; Bloom's is
 *    in percent),
 *  - the currency and locale every amount is formatted in, and the labels.
 *
 * The calculator draws its own heading, so the section adds none.
 */
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { MortgageCalculator, type MortgageCalculatorLabels } from '@oxy.so/bloom/listing-actions';

import { Section } from '@/components/property/Section';
import { useFormatting } from '@/utils/format';
import { DEFAULT_MORTGAGE_CONFIG, formatMoney } from '@homiio/shared-types';

interface Props {
  salePrice: number;
  currency: string;
}

/** Decimal places kept converting the rate, so 0.035 reads 3.5 and not 3.5000000000000004. */
const RATE_PRECISION = 1000;
const DEFAULT_ANNUAL_RATE_PERCENT =
  Math.round(DEFAULT_MORTGAGE_CONFIG.defaultAnnualRate * 100 * RATE_PRECISION) / RATE_PRECISION;
/** The middle term option (25 years of 10–30), as the calculator opens on it. */
const DEFAULT_TERM_YEARS =
  DEFAULT_MORTGAGE_CONFIG.termOptions[Math.floor(DEFAULT_MORTGAGE_CONFIG.termOptions.length / 2)] ??
  DEFAULT_MORTGAGE_CONFIG.termOptions[0];

export const MortgageCalculatorSection: React.FC<Props> = ({ salePrice, currency }) => {
  const { t } = useTranslation();
  const { locale } = useFormatting();

  const formatCurrency = useCallback(
    (amount: number) => formatMoney(Math.round(amount), currency, locale, { maximumFractionDigits: 0 }),
    [currency, locale],
  );

  const labels = useMemo<MortgageCalculatorLabels>(
    () => ({
      title: t('listing.mortgage.title'),
      price: t('listing.mortgage.price'),
      downPayment: t('listing.mortgage.downPayment'),
      downPaymentPercent: t('listing.mortgage.downPaymentPercent'),
      percent: t('listing.mortgage.percent'),
      term: t('listing.mortgage.term'),
      years: t('listing.mortgage.yearsUnit'),
      rate: t('listing.mortgage.interestRate'),
      monthlyPayment: t('listing.mortgage.monthlyPayment'),
      principal: t('listing.mortgage.principal'),
      interest: t('listing.mortgage.interest'),
      loanAmount: t('listing.mortgage.loanAmount'),
      totalInterest: t('listing.mortgage.totalInterest'),
      totalCost: t('listing.mortgage.totalCost'),
    }),
    [t],
  );

  return (
    <Section>
      <MortgageCalculator
        defaultPrice={salePrice}
        defaultDownPayment={Math.round(salePrice * DEFAULT_MORTGAGE_CONFIG.defaultDownPaymentFraction)}
        defaultYears={DEFAULT_TERM_YEARS}
        defaultAnnualRate={DEFAULT_ANNUAL_RATE_PERCENT}
        termOptions={DEFAULT_MORTGAGE_CONFIG.termOptions}
        formatCurrency={formatCurrency}
        labels={labels}
        disclaimer={t('listing.mortgage.disclaimer')}
      />
    </Section>
  );
};

export default MortgageCalculatorSection;
