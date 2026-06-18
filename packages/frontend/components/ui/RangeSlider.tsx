/**
 * RangeSlider — a presentation-agnostic, dependency-free horizontal slider over
 * a numeric range, built on `PanResponder` (works on native + RN-Web).
 *
 * It renders ONLY the track + fill + thumb and owns the gesture + accessibility
 * (the adjustable role with single-`step` increment/decrement). It carries no
 * labels or value readout — each caller wraps it with its own copy. This is the
 * shared core extracted from the earnings calculator's value slider and the
 * mortgage calculator's down-payment slider, which were near-identical.
 *
 * The range is expressed in whatever units the caller stores: the earnings
 * calculator drives it in whole euros (e.g. 400–5000 step 50) and the mortgage
 * calculator in a fraction (0.05–0.5 step 0.05). Because the math is purely
 * proportional, both work unchanged. For accessibility, `accessibilityValueText`
 * supplies the spoken value (e.g. "20%" or "€1,200"), `accessibilityNow` maps
 * the value to the integer announced via `accessibilityValue.now`, and
 * `accessibilityMin`/`accessibilityMax` override the announced bounds (so a
 * fraction slider can report 5–50 instead of 0.05–0.5).
 *
 * Memoised (`React.memo`) and expecting a stable `onChange` (wrap in
 * `useCallback`) so a drag re-renders only the slider, not the caller's
 * surrounding layout.
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

import { colors } from '@/styles/colors';
import { shadowToken } from '@/styles/shadows';
import { radius, spacing } from '@/constants/styles';

/** Slider thumb diameter, shared by every caller for a consistent control. */
export const SLIDER_THUMB_SIZE = 24;

/** Clamp a number into [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Snap a raw value to the nearest `step` within [min, max]. */
function snap(value: number, min: number, max: number, step: number): number {
  const snapped = Math.round(value / step) * step;
  return clamp(snapped, min, max);
}

interface RangeSliderProps {
  value: number;
  min: number;
  max: number;
  /** Granularity the drag snaps to. */
  step: number;
  /**
   * Granularity for keyboard / screen-reader increment & decrement. Defaults to
   * `step`; pass a coarser value when the drag should be finer than a key press
   * (e.g. the mortgage slider drags by 1% but steps by 5%).
   */
  keyboardStep?: number;
  onChange: (value: number) => void;
  /** Spoken label for the control (e.g. "Down payment", "Monthly rent"). */
  accessibilityLabel: string;
  /** Spoken value text (e.g. "20%" or "€1,200"); falls back to the raw value. */
  accessibilityValueText?: string;
  /**
   * Maps the value to the integer announced via `accessibilityValue.now`
   * (e.g. a 0.2 fraction → 20 for a percent slider). Defaults to the rounded
   * value so callers whose units are already user-facing need not pass it.
   */
  accessibilityNow?: (value: number) => number;
  /** Announced lower bound (`accessibilityValue.min`); defaults to `min`. */
  accessibilityMin?: number;
  /** Announced upper bound (`accessibilityValue.max`); defaults to `max`. */
  accessibilityMax?: number;
}

/**
 * Snap-to-`step` horizontal slider. See file header for the contract; callers
 * own all surrounding labels/readouts.
 */
const RangeSliderComponent: React.FC<RangeSliderProps> = ({
  value,
  min,
  max,
  step,
  keyboardStep,
  onChange,
  accessibilityLabel,
  accessibilityValueText,
  accessibilityNow,
  accessibilityMin,
  accessibilityMax,
}) => {
  const stepBy = keyboardStep ?? step;
  // Track width is layout-derived state (not a ref), so the PanResponder can
  // close over it directly and is simply rebuilt on the rare layout change.
  const [trackWidth, setTrackWidth] = useState(0);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  const positionToValue = useCallback(
    (offsetX: number): number => {
      if (trackWidth <= 0) return value;
      const ratio = clamp(offsetX / trackWidth, 0, 1);
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
          // locationX is relative to the track; fall back to moveX math when 0.
          const offsetX = event.nativeEvent.locationX || clamp(gesture.moveX, 0, trackWidth);
          onChange(positionToValue(offsetX));
        },
      }),
    [onChange, positionToValue, trackWidth],
  );

  const ratio = (value - min) / (max - min);
  const fillWidth = trackWidth * clamp(ratio, 0, 1);
  const now = accessibilityNow ? accessibilityNow(value) : Math.round(value);

  return (
    <View
      style={styles.sliderHitbox}
      onLayout={handleLayout}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{
        now,
        min: accessibilityMin ?? min,
        max: accessibilityMax ?? max,
        text: accessibilityValueText,
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') {
          onChange(clamp(value + stepBy, min, max));
        } else if (event.nativeEvent.actionName === 'decrement') {
          onChange(clamp(value - stepBy, min, max));
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

/**
 * Memoised so a drag only re-renders the slider (and the caller's value readout)
 * rather than the whole surrounding screen. Requires a stable `onChange`.
 */
export const RangeSlider = React.memo(RangeSliderComponent);

const styles = StyleSheet.create({
  // Generous vertical hitbox around the thin track so the thumb is easy to grab.
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
});

export default RangeSlider;
