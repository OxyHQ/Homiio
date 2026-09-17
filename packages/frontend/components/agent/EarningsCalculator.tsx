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
 * Bloom `Slider` (the same control the mortgage calculator uses). Sale and
 * exchange are flat, so they show the reward prominently with a short note
 * instead of a misleading slider. The result is rendered as a big gold number;
 * slider bounds/steps are named constants (no magic numbers).
 *
 * Render isolation: while the rent slider is dragged it updates `rent` every
 * frame. The live "monthly rent" readout + slider live in their own memoised
 * `RentControl` so a drag re-renders only that block — not the SegmentedControl
 * or the result copy. The slider's `onChange` (`setRent`) is referentially
 * stable.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, type TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card } from '@oxy.so/bloom/card';
import { Divider } from '@oxy.so/bloom/divider';
import { useTheme } from '@oxy.so/bloom/theme';
import { H2, Text as BloomText } from '@oxy.so/bloom/typography';
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxy.so/bloom/segmented-control';

import { Slider } from '@oxy.so/bloom/slider';
import { resolvePagePadding } from '@/constants/styles';
import { formatMoney } from '@homiio/shared-types';
import { useFormatting } from '@/utils/format';
import { useMediaQuery } from 'react-responsive';
import { COMMISSION_CONFIG, commissionAmount, type CommissionOffering } from '@homiio/shared-types';

/** Tabular figures so the live amounts don't jitter while the slider drags. */
const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

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
  ({ rent, onChange, label, perMonth, currency }) => {
    const { locale } = useFormatting();
    const theme = useTheme();
    return (
      <View className="gap-2">
        <View className="flex-row items-center justify-between gap-3">
          <BloomText variant="body-medium" style={{ color: theme.colors.text }}>
            {label}
          </BloomText>
          <BloomText variant="body-semibold" style={[TABULAR, { color: theme.colors.text }]}>
            {`${formatMoney(rent, currency, locale, WHOLE_CURRENCY)} / ${perMonth}`}
          </BloomText>
        </View>
        <Slider
          value={rent}
          min={RENT_RANGE.min}
          max={RENT_RANGE.max}
          step={RENT_RANGE.step}
          onValueChange={onChange}
          showTooltip={false}
          accessibilityLabel={label}
        />
      </View>
    );
  },
);
RentControl.displayName = 'RentControl';

export const EarningsCalculator: React.FC = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale } = useFormatting();
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
      <Card
        variant="outlined"
        radius="radius-24"
        className="w-full max-w-[720px] self-center gap-6 p-6"
      >
        <H2 style={{ color: theme.colors.text }}>{title}</H2>

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
          <BloomText variant="body-regular" style={{ color: theme.colors.textSecondary }}>
            {flatNote}
          </BloomText>
        )}

        <Divider />

        <View className="items-center gap-1">
          <BloomText
            variant="caption-1-semibold"
            style={{ color: theme.colors.textSecondary, textTransform: 'uppercase' }}
          >
            {t('agent.calculator.result')}
          </BloomText>
          <BloomText variant="display-2-bold" style={[TABULAR, { color: theme.colors.primary }]}>
            {formatMoney(payout, currency, locale, WHOLE_CURRENCY)}
          </BloomText>
          <BloomText
            variant="body-2-regular"
            style={{ color: theme.colors.textSecondary, textAlign: 'center' }}
          >
            {t('agent.calculator.caption')}
          </BloomText>
        </View>
      </Card>
    </View>
  );
};

export default EarningsCalculator;
