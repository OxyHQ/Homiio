/**
 * MortgageCalculatorSection — an interactive affordability estimator shown on
 * sale listings. Lets a buyer flex the down payment, interest rate, and term
 * and see the resulting monthly payment, with a principal-vs-interest split.
 *
 * State is fully local and effect-free (CLAUDE.md: avoid `useEffect`): the three
 * inputs are React state, and every output (loan amount, monthly payment,
 * totals, the split bar) is derived with `useMemo`. Defaults come from the
 * single shared `DEFAULT_MORTGAGE_CONFIG` in `@homiio/shared-types` so the
 * frontend and backend never disagree on the baseline assumptions.
 *
 * The down-payment control is the shared `RangeSlider` (no extra dependency,
 * works on native + RN-Web) constrained to 5%–50%, driven in fraction units. The
 * term is a Bloom `SegmentedControl` seeded from `termOptions`.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text as BloomText } from '@oxyhq/bloom/typography';
import * as SegmentedControl from '@oxyhq/bloom/segmented-control';

import { Section } from '@/components/property/Section';
import { CurrencyFormatter } from '@/components/CurrencyFormatter';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { parseLocaleNumber } from '@/utils/number';
import { colors } from '@/styles/colors';
import { hairline, radius, spacing } from '@/constants/styles';
import { DEFAULT_MORTGAGE_CONFIG } from '@homiio/shared-types';

interface Props {
  salePrice: number;
  currency: string;
}

const MIN_DOWN_PAYMENT_FRACTION = 0.05;
const MAX_DOWN_PAYMENT_FRACTION = 0.5;
/** Drag snaps to whole percentage points (1pp) for a tidy, predictable value. */
const DOWN_PAYMENT_DRAG_STEP = 0.01;
/** Screen-reader / keyboard increment & decrement step (5 percentage points). */
const DOWN_PAYMENT_KEYBOARD_STEP = 0.05;
const MONTHS_PER_YEAR = 12;
const PERCENT = 100;
/** Decimal places kept when seeding the rate field (avoids float-noise like 3.5000000000000004). */
const RATE_PERCENT_PRECISION = 3;

/** Format an annual-rate fraction (0.035) as a clean percent string ("3.5"). */
function rateFractionToPercentText(fraction: number): string {
  return parseFloat((fraction * PERCENT).toFixed(RATE_PERCENT_PRECISION)).toString();
}

/**
 * Standard fixed-rate amortization. Returns the level monthly payment for a
 * `principal` at monthly rate `monthlyRate` over `months` payments. Guards the
 * zero-rate case (interest-free) where the closed form divides by zero.
 */
function monthlyPayment(principal: number, monthlyRate: number, months: number): number {
  if (months <= 0) return 0;
  if (monthlyRate === 0) return principal / months;
  const growth = Math.pow(1 + monthlyRate, months);
  return (principal * monthlyRate * growth) / (growth - 1);
}

/** Map a down-payment fraction (0.2) to its announced percent integer (20). */
function fractionToPercent(fraction: number): number {
  return Math.round(fraction * PERCENT);
}

export const MortgageCalculatorSection: React.FC<Props> = ({ salePrice, currency }) => {
  const { t } = useTranslation();

  const [downPaymentFraction, setDownPaymentFraction] = useState(
    DEFAULT_MORTGAGE_CONFIG.defaultDownPaymentFraction,
  );
  // The rate field is a free-text percentage (e.g. "3.5"); keep the raw string
  // so partial edits don't fight the parser, and derive the numeric rate.
  const [annualRateText, setAnnualRateText] = useState(
    rateFractionToPercentText(DEFAULT_MORTGAGE_CONFIG.defaultAnnualRate),
  );
  const [termYears, setTermYears] = useState(
    DEFAULT_MORTGAGE_CONFIG.termOptions[
      Math.floor(DEFAULT_MORTGAGE_CONFIG.termOptions.length / 2)
    ] ?? DEFAULT_MORTGAGE_CONFIG.termOptions[0],
  );

  const annualRate = useMemo(() => {
    // Comma-tolerant parse (es/it/ca keyboards), shared with the listing wizard.
    const parsed = parseLocaleNumber(annualRateText);
    if (Number.isNaN(parsed) || parsed < 0) return 0;
    return parsed / PERCENT;
  }, [annualRateText]);

  const result = useMemo(() => {
    const loanAmount = Math.max(salePrice * (1 - downPaymentFraction), 0);
    const downPayment = salePrice - loanAmount;
    const months = termYears * MONTHS_PER_YEAR;
    const monthly = monthlyPayment(loanAmount, annualRate / MONTHS_PER_YEAR, months);
    const totalPaid = monthly * months;
    const totalInterest = Math.max(totalPaid - loanAmount, 0);
    const principalShare = totalPaid > 0 ? loanAmount / totalPaid : 1;
    return { loanAmount, downPayment, monthly, totalPaid, totalInterest, principalShare };
  }, [salePrice, downPaymentFraction, termYears, annualRate]);

  const handleSetTerm = useCallback((value: string) => {
    const parsed = parseInt(value, 10);
    if (!Number.isNaN(parsed)) setTermYears(parsed);
  }, []);

  const downPaymentPercentLabel = `${Math.round(downPaymentFraction * PERCENT)}%`;
  const principalPercent = Math.round(result.principalShare * PERCENT);
  const interestPercent = PERCENT - principalPercent;

  return (
    <Section
      title={t('listing.mortgage.title', 'Mortgage calculator')}
      subtitle={t('listing.mortgage.subtitle', 'An estimate — not a mortgage offer.')}
    >
      {/* Monthly payment headline */}
      <View style={styles.headline}>
        <CurrencyFormatter
          amount={Math.round(result.monthly)}
          originalCurrency={currency}
          showConversion={false}
          style={styles.monthly}
        />
        <BloomText style={styles.monthlyUnit}>
          {` / ${t('listing.mortgage.perMonth', 'mo')}`}
        </BloomText>
      </View>

      {/* Down payment slider */}
      <View style={styles.control}>
        <View style={styles.controlHeader}>
          <BloomText style={styles.controlLabel}>
            {t('listing.mortgage.downPayment', 'Down payment')}
          </BloomText>
          <BloomText style={styles.controlValue}>
            {downPaymentPercentLabel}
            {'  ·  '}
            <CurrencyFormatter
              amount={Math.round(result.downPayment)}
              originalCurrency={currency}
              showConversion={false}
              style={styles.controlValue}
            />
          </BloomText>
        </View>
        <RangeSlider
          value={downPaymentFraction}
          min={MIN_DOWN_PAYMENT_FRACTION}
          max={MAX_DOWN_PAYMENT_FRACTION}
          step={DOWN_PAYMENT_DRAG_STEP}
          keyboardStep={DOWN_PAYMENT_KEYBOARD_STEP}
          onChange={setDownPaymentFraction}
          accessibilityLabel={t('listing.mortgage.downPayment', 'Down payment')}
          accessibilityNow={fractionToPercent}
          accessibilityMin={fractionToPercent(MIN_DOWN_PAYMENT_FRACTION)}
          accessibilityMax={fractionToPercent(MAX_DOWN_PAYMENT_FRACTION)}
        />
      </View>

      {/* Interest rate */}
      <View style={styles.control}>
        <View style={styles.controlHeader}>
          <BloomText style={styles.controlLabel}>
            {t('listing.mortgage.interestRate', 'Interest rate')}
          </BloomText>
        </View>
        <View style={styles.rateInputRow}>
          <TextInput
            style={styles.rateInput}
            value={annualRateText}
            onChangeText={setAnnualRateText}
            keyboardType="decimal-pad"
            placeholder="0"
            accessibilityLabel={t('listing.mortgage.interestRate', 'Interest rate')}
          />
          <BloomText style={styles.ratePercent}>%</BloomText>
        </View>
      </View>

      {/* Term */}
      <View style={styles.control}>
        <View style={styles.controlHeader}>
          <BloomText style={styles.controlLabel}>
            {t('listing.mortgage.term', 'Term')}
          </BloomText>
        </View>
        <SegmentedControl.Root
          label={t('listing.mortgage.term', 'Term')}
          type="radio"
          value={String(termYears)}
          onChange={handleSetTerm}
        >
          {DEFAULT_MORTGAGE_CONFIG.termOptions.map((option) => (
            <SegmentedControl.Item key={option} value={String(option)}>
              <SegmentedControl.ItemText>
                {t('listing.mortgage.years', '{{count}} yr', { count: option })}
              </SegmentedControl.ItemText>
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
      </View>

      {/* Principal vs interest split bar */}
      <View style={styles.splitBlock}>
        <View style={styles.splitBar}>
          <View style={[styles.splitPrincipal, { flex: Math.max(result.principalShare, 0.0001) }]} />
          <View
            style={[styles.splitInterest, { flex: Math.max(1 - result.principalShare, 0.0001) }]}
          />
        </View>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.primaryColor }]} />
            <BloomText style={styles.legendLabel}>
              {`${t('listing.mortgage.principal', 'Principal')} · ${principalPercent}%`}
            </BloomText>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.warning }]} />
            <BloomText style={styles.legendLabel}>
              {`${t('listing.mortgage.interest', 'Interest')} · ${interestPercent}%`}
            </BloomText>
          </View>
        </View>
      </View>

      {/* Totals */}
      <View style={styles.totals}>
        <View style={styles.totalRow}>
          <BloomText style={styles.totalLabel}>
            {t('listing.mortgage.loanAmount', 'Loan amount')}
          </BloomText>
          <CurrencyFormatter
            amount={Math.round(result.loanAmount)}
            originalCurrency={currency}
            showConversion={false}
            style={styles.totalValue}
          />
        </View>
        <View style={styles.totalRow}>
          <BloomText style={styles.totalLabel}>
            {t('listing.mortgage.totalInterest', 'Total interest')}
          </BloomText>
          <CurrencyFormatter
            amount={Math.round(result.totalInterest)}
            originalCurrency={currency}
            showConversion={false}
            style={styles.totalValue}
          />
        </View>
        <View style={[styles.totalRow, styles.totalRowEmphasis]}>
          <BloomText style={styles.totalLabelStrong}>
            {t('listing.mortgage.totalPaid', 'Total paid')}
          </BloomText>
          <CurrencyFormatter
            amount={Math.round(result.totalPaid)}
            originalCurrency={currency}
            showConversion={false}
            style={styles.totalValueStrong}
          />
        </View>
      </View>
    </Section>
  );
};

const styles = StyleSheet.create({
  headline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingBottom: spacing.md,
  },
  monthly: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: -0.4,
  },
  monthlyUnit: {
    fontSize: 16,
    fontWeight: '400',
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  control: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  controlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  controlLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  controlValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  rateInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: hairline.width,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.md,
  },
  rateInput: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.COLOR_BLACK,
  },
  ratePercent: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  splitBlock: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  splitBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  splitPrincipal: {
    backgroundColor: colors.primaryColor,
  },
  splitInterest: {
    backgroundColor: colors.warning,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  totals: {
    marginTop: spacing.xl,
    gap: spacing.xs,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    gap: spacing.lg,
  },
  totalRowEmphasis: {
    marginTop: spacing.xs,
    paddingTop: spacing.md,
    borderTopWidth: hairline.width,
    borderTopColor: hairline.color,
  },
  totalLabel: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  totalValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  totalLabelStrong: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  totalValueStrong: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
});

export default MortgageCalculatorSection;
