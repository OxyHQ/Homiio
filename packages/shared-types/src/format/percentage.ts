/**
 * Percentage formatting.
 *
 * `Intl.NumberFormat`'s `style: 'percent'` multiplies by 100, so `0.2` renders
 * as `20%`. Homiio stores percentages BOTH ways — `defaultDownPaymentFraction`
 * is `0.20` while `recommendationPercentage` is `87` — which is exactly the
 * ambiguity that produces an `8,700%` on somebody's agency page. `input` names
 * which one the caller holds; it defaults to `'fraction'` to match `Intl`'s own
 * convention, and getting it wrong is loud (off by 100×) rather than subtle.
 *
 * The locale still matters even though `%` is near-universal: the separator
 * before the sign is not (`20 %` in French, `20%` in English), and the decimal
 * separator differs.
 */

/** Whether the caller's number is a fraction (`0.2`) or already a percent (`20`). */
export type PercentageInput = 'fraction' | 'percent';

/** Options accepted by {@link formatPercentage}. */
export interface FormatPercentageOptions {
  /** Defaults to `'fraction'`, matching `Intl`'s `style: 'percent'`. */
  input?: PercentageInput;
  /** Minimum fraction digits on the rendered percentage. Defaults to `0`. */
  minimumFractionDigits?: number;
  /** Maximum fraction digits on the rendered percentage. Defaults to `1`. */
  maximumFractionDigits?: number;
}

/**
 * Format `value` as a percentage for `locale`.
 *
 * A non-finite value formats as `0%` rather than letting `NaN%` reach a card.
 * A malformed locale degrades to the runtime default rather than throwing.
 */
export function formatPercentage(
  value: number,
  locale: string,
  options: FormatPercentageOptions = {},
): string {
  const minimumFractionDigits = options.minimumFractionDigits ?? 0;
  const maximumFractionDigits = Math.max(
    minimumFractionDigits,
    options.maximumFractionDigits ?? 1,
  );
  const safeValue = Number.isFinite(value) ? value : 0;
  // `style: 'percent'` expects a fraction, so a caller holding `87` for 87% has
  // to be scaled down before it is multiplied back up.
  const fraction = (options.input ?? 'fraction') === 'percent' ? safeValue / 100 : safeValue;

  const intlOptions: Intl.NumberFormatOptions = {
    style: 'percent',
    minimumFractionDigits,
    maximumFractionDigits,
  };
  try {
    return new Intl.NumberFormat(locale, intlOptions).format(fraction);
  } catch {
    return new Intl.NumberFormat(undefined, intlOptions).format(fraction);
  }
}
