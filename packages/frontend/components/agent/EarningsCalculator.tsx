/**
 * EarningsCalculator — interactive "see what you could earn" estimator.
 *
 * Homiio is a very low-fee platform, so partner payouts are small and mostly
 * flat. The user picks an offering (rent / sale / exchange); the payout is
 * derived live — effect-free, all `useMemo` — straight from `COMMISSION_CONFIG`,
 * the single source of truth shared with the backend:
 *
 *   rent     payout = monthlyRent × payout.rent.value   (3% of first month)
 *   sale     payout = payout.sale.value                 (flat reward)
 *   exchange payout = payout.exchange.value             (flat reward)
 *
 * Only rent varies with a deal value, so only the rent tab shows a slider — the
 * shared `RangeSlider` (the same control the mortgage calculator uses). Sale and
 * exchange are flat, so they show the reward prominently with a short note
 * instead of a misleading slider. The result is rendered as a big gold number;
 * slider bounds/steps are named constants (no magic numbers).
 *
 * Render isolation: while the rent slider is dragged it updates `rent` every
 * frame. The live "monthly rent" readout + slider live in their own memoised
 * `RentControl` so a drag re-renders only that block — not the SegmentedControl
 * or the result copy. The slider's `onChange` (`setRent`) is referentially
 * stable, and `RangeSlider` is itself `React.memo`.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { H1, Text as BloomText } from '@oxyhq/bloom/typography';
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxyhq/bloom/segmented-control';

import { RangeSlider } from '@/components/ui/RangeSlider';
import { colors } from '@/styles/colors';
import { hairline, radius, resolvePagePadding, spacing, tracker } from '@/constants/styles';
import { formatCurrency } from '@/utils/currency';
import { useMediaQuery } from 'react-responsive';
import { COMMISSION_CONFIG, commissionAmount, type CommissionOffering } from '@homiio/shared-types';

/** Whole-€ display (no decimals) for the calculator's amounts. */
const WHOLE_CURRENCY = { minimumFractionDigits: 0, maximumFractionDigits: 0 } as const;

/**
 * Slider bounds + step for the rent tab's monthly-rent input (in monthly €
 * steps). Rent is the only offering whose payout varies with a deal value; sale
 * and exchange are flat, so they have no slider. The default lands on the spec's
 * worked example: €1,200/mo → €36.
 */
const RENT_RANGE = { min: 400, max: 5000, step: 50, default: 1200 } as const;

/** The three offerings, in display order, mapped to the segmented control. */
const OFFERINGS: readonly CommissionOffering[] = ['rent', 'sale', 'exchange'] as const;

interface OfferingSelectorProps {
  offering: CommissionOffering;
  onChange: (value: string) => void;
  label: string;
  offeringLabels: Record<CommissionOffering, string>;
}

/**
 * Offering tabs (rent / sale / exchange), isolated behind `React.memo`. Its
 * inputs don't change while the rent slider is dragged, so memoising it keeps
 * the segmented control out of the per-frame drag re-renders. Requires a stable
 * `onChange` and `offeringLabels`.
 */
const OfferingSelector: React.FC<OfferingSelectorProps> = React.memo(
  ({ offering, onChange, label, offeringLabels }) => (
    <SegmentedControl label={label} type="radio" value={offering} onChange={onChange}>
      {OFFERINGS.map((key) => (
        <SegmentedControlItem key={key} value={key}>
          <SegmentedControlItemText>{offeringLabels[key]}</SegmentedControlItemText>
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  ),
);
OfferingSelector.displayName = 'OfferingSelector';

interface RentControlProps {
  rent: number;
  onChange: (rent: number) => void;
  label: string;
  perMonth: string;
  currency: string;
}

/**
 * Live monthly-rent readout + slider, isolated behind `React.memo` so dragging
 * (which updates `rent` per frame) re-renders only this block, not the parent's
 * segmented control or result copy. Requires a stable `onChange`.
 */
const RentControl: React.FC<RentControlProps> = React.memo(
  ({ rent, onChange, label, perMonth, currency }) => (
    <View style={styles.control}>
      <View style={styles.controlHeader}>
        <BloomText style={styles.controlLabel}>{label}</BloomText>
        <BloomText style={styles.controlValue}>
          {`${formatCurrency(rent, currency, WHOLE_CURRENCY)} / ${perMonth}`}
        </BloomText>
      </View>
      <RangeSlider
        value={rent}
        min={RENT_RANGE.min}
        max={RENT_RANGE.max}
        step={RENT_RANGE.step}
        onChange={onChange}
        accessibilityLabel={label}
      />
    </View>
  ),
);
RentControl.displayName = 'RentControl';

export const EarningsCalculator: React.FC = () => {
  const { t } = useTranslation();
  const isWide = useMediaQuery({ minWidth: 768 });
  const horizontalPadding = resolvePagePadding(isWide);

  const [offering, setOffering] = useState<CommissionOffering>('rent');
  const [rent, setRent] = useState<number>(RENT_RANGE.default);

  const handleSetOffering = useCallback((value: string) => {
    if (value === 'rent' || value === 'sale' || value === 'exchange') {
      setOffering(value);
    }
  }, []);

  // Payout from the shared rule — the single source of truth with the backend
  // ledger. Only rent varies with the deal value; sale/exchange are flat, so
  // they ignore `rent`.
  const payout = useMemo(() => commissionAmount(offering, rent), [offering, rent]);

  const { currency } = COMMISSION_CONFIG;

  // `t` is stable per language; memoise so the label map isn't rebuilt on every
  // slider-drag frame.
  const offeringLabels = useMemo<Record<CommissionOffering, string>>(
    () => ({
      rent: t('agent.calculator.offerings.rent'),
      sale: t('agent.calculator.offerings.sale'),
      exchange: t('agent.calculator.offerings.exchange'),
    }),
    [t],
  );

  const title = t('agent.calculator.title');
  const inputLabel = t('agent.calculator.monthlyRent');
  const perMonth = t('agent.calculator.perMonth');

  // Sale/exchange are flat rewards, so we show a short note instead of a
  // misleading slider that would imply the payout scales with the deal value.
  const flatNote =
    offering === 'sale'
      ? t('agent.calculator.flatNoteSale')
      : t('agent.calculator.flatNoteExchange');

  return (
    <View style={{ paddingHorizontal: horizontalPadding }}>
      <View style={styles.card}>
        <View style={styles.header}>
          <H1 style={styles.title}>{title}</H1>
        </View>

        <OfferingSelector
          offering={offering}
          onChange={handleSetOffering}
          label={title}
          offeringLabels={offeringLabels}
        />

        {offering === 'rent' ? (
          <RentControl
            rent={rent}
            onChange={setRent}
            label={inputLabel}
            perMonth={perMonth}
            currency={currency}
          />
        ) : (
          <BloomText style={styles.flatNote}>{flatNote}</BloomText>
        )}

        <View style={styles.resultBlock}>
          <BloomText style={styles.resultLabel}>
            {t('agent.calculator.result')}
          </BloomText>
          <H1 style={styles.resultAmount}>{formatCurrency(payout, currency, WHOLE_CURRENCY)}</H1>
          <BloomText style={styles.resultCaption}>
            {t('agent.calculator.caption')}
          </BloomText>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.xl,
    borderWidth: hairline.width,
    borderColor: colors.border,
    padding: spacing['2xl'],
    gap: spacing.xl,
  },
  header: {
    gap: spacing.xs,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: tracker.tight,
    lineHeight: 32,
  },
  control: {
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
    fontSize: 15,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  flatNote: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  resultBlock: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.lg,
    borderTopWidth: hairline.width,
    borderTopColor: hairline.color,
  },
  resultLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.COLOR_BLACK_LIGHT_3,
    textTransform: 'uppercase',
    letterSpacing: tracker.eyebrow,
  },
  resultAmount: {
    fontSize: 48,
    fontWeight: '800',
    color: colors.primaryColor,
    letterSpacing: tracker.tight,
    lineHeight: 54,
  },
  resultCaption: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
  },
});

export default EarningsCalculator;
