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
 * Only rent varies with a deal value, so only the rent tab shows a slider
 * (dependency-free `PanResponder`, native + RN-Web, mirroring
 * `MortgageCalculatorSection.DownPaymentSlider`). Sale and exchange are flat, so
 * they show the reward prominently with a short note instead of a misleading
 * slider. The result is rendered as a big gold number; slider bounds/steps are
 * named constants (no magic numbers).
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { H1, Text as BloomText } from '@oxyhq/bloom/typography';
import * as SegmentedControl from '@oxyhq/bloom/segmented-control';

import { colors } from '@/styles/colors';
import { shadowToken } from '@/styles/shadows';
import { hairline, radius, resolvePagePadding, spacing, tracker } from '@/constants/styles';
import { formatCurrency } from '@/utils/currency';
import { useMediaQuery } from 'react-responsive';
import { COMMISSION_CONFIG, commissionAmount, type CommissionOffering } from '@homiio/shared-types';

/** Whole-€ display (no decimals) for the calculator's amounts. */
const WHOLE_CURRENCY = { minimumFractionDigits: 0, maximumFractionDigits: 0 } as const;

/** Slider thumb diameter (matches the mortgage calculator). */
const SLIDER_THUMB_SIZE = 24;

/**
 * Slider bounds + step for the rent tab's monthly-rent input (in monthly €
 * steps). Rent is the only offering whose payout varies with a deal value; sale
 * and exchange are flat, so they have no slider. The default lands on the spec's
 * worked example: €1,200/mo → €36.
 */
const RENT_RANGE = { min: 400, max: 5000, step: 50, default: 1200 } as const;

/** The three offerings, in display order, mapped to the segmented control. */
const OFFERINGS: readonly CommissionOffering[] = ['rent', 'sale', 'exchange'] as const;

/** Clamp a number into [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Snap a raw value to the nearest `step` within [min, max]. */
function snap(value: number, min: number, max: number, step: number): number {
  const snapped = Math.round(value / step) * step;
  return clamp(snapped, min, max);
}

interface ValueSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  accessibilityLabel: string;
}

/**
 * Dependency-free horizontal slider over a numeric range, built on
 * `PanResponder` (native + RN-Web). Exposes the adjustable a11y role with
 * single-step increment/decrement actions.
 */
const ValueSlider: React.FC<ValueSliderProps> = ({
  value,
  min,
  max,
  step,
  onChange,
  accessibilityLabel,
}) => {
  const [trackWidth, setTrackWidth] = useState(0);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  const positionToValue = useCallback(
    (x: number): number => {
      if (trackWidth <= 0) return value;
      const ratio = clamp(x / trackWidth, 0, 1);
      return snap(min + ratio * (max - min), min, max, step);
    },
    [trackWidth, value, min, max, step],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event: GestureResponderEvent) => {
          onChange(positionToValue(event.nativeEvent.locationX));
        },
        onPanResponderMove: (
          event: GestureResponderEvent,
          gesture: PanResponderGestureState,
        ) => {
          const x = event.nativeEvent.locationX || clamp(gesture.moveX, 0, trackWidth);
          onChange(positionToValue(x));
        },
      }),
    [onChange, positionToValue, trackWidth],
  );

  const ratio = (value - min) / (max - min);
  const fillWidth = trackWidth * clamp(ratio, 0, 1);

  return (
    <View
      style={styles.sliderHitbox}
      onLayout={handleLayout}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ now: Math.round(value), min, max }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') {
          onChange(clamp(value + step, min, max));
        } else if (event.nativeEvent.actionName === 'decrement') {
          onChange(clamp(value - step, min, max));
        }
      }}
      {...panResponder.panHandlers}
    >
      <View style={styles.sliderTrack}>
        <View style={[styles.sliderFill, { width: fillWidth }]} />
        <View
          style={[
            styles.sliderThumb,
            {
              left: clamp(
                fillWidth - SLIDER_THUMB_SIZE / 2,
                0,
                Math.max(trackWidth - SLIDER_THUMB_SIZE, 0),
              ),
            },
          ]}
        />
      </View>
    </View>
  );
};

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
      rent: t('agent.calculator.offerings.rent', 'Rent'),
      sale: t('agent.calculator.offerings.sale', 'Sale'),
      exchange: t('agent.calculator.offerings.exchange', 'Exchange'),
    }),
    [t],
  );

  const title = t('agent.calculator.title', 'See what you could earn');
  const inputLabel = t('agent.calculator.monthlyRent', 'Monthly rent');

  // Sale/exchange are flat rewards, so we show a short note instead of a
  // misleading slider that would imply the payout scales with the deal value.
  const flatNote =
    offering === 'sale'
      ? t('agent.calculator.flatNoteSale', 'Flat reward per closed sale')
      : t('agent.calculator.flatNoteExchange', 'Flat reward per exchange');

  return (
    <View style={{ paddingHorizontal: horizontalPadding }}>
      <View style={styles.card}>
        <View style={styles.header}>
          <H1 style={styles.title}>{title}</H1>
        </View>

        <SegmentedControl.Root
          label={title}
          type="radio"
          value={offering}
          onChange={handleSetOffering}
        >
          {OFFERINGS.map((key) => (
            <SegmentedControl.Item key={key} value={key}>
              <SegmentedControl.ItemText>{offeringLabels[key]}</SegmentedControl.ItemText>
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>

        {offering === 'rent' ? (
          <View style={styles.control}>
            <View style={styles.controlHeader}>
              <BloomText style={styles.controlLabel}>{inputLabel}</BloomText>
              <BloomText style={styles.controlValue}>
                {`${formatCurrency(rent, currency, WHOLE_CURRENCY)} / ${t('agent.calculator.perMonth', 'mo')}`}
              </BloomText>
            </View>
            <ValueSlider
              value={rent}
              min={RENT_RANGE.min}
              max={RENT_RANGE.max}
              step={RENT_RANGE.step}
              onChange={setRent}
              accessibilityLabel={inputLabel}
            />
          </View>
        ) : (
          <BloomText style={styles.flatNote}>{flatNote}</BloomText>
        )}

        <View style={styles.resultBlock}>
          <BloomText style={styles.resultLabel}>
            {t('agent.calculator.result', 'You earn')}
          </BloomText>
          <H1 style={styles.resultAmount}>{formatCurrency(payout, currency, WHOLE_CURRENCY)}</H1>
          <BloomText style={styles.resultCaption}>
            {t('agent.calculator.caption', 'Paid when the deal closes — no license needed.')}
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
  sliderHitbox: {
    height: SLIDER_THUMB_SIZE + spacing.md,
    justifyContent: 'center',
  },
  sliderTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
    justifyContent: 'center',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryColor,
  },
  sliderThumb: {
    position: 'absolute',
    width: SLIDER_THUMB_SIZE,
    height: SLIDER_THUMB_SIZE,
    borderRadius: SLIDER_THUMB_SIZE / 2,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    ...shadowToken({ y: 1, blur: 3, color: colors.COLOR_BLACK, opacity: 0.18, elevation: 3 }),
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
