/**
 * Plain-number formatting.
 *
 * `Number#toLocaleString()` with no argument formats in the RUNTIME's locale —
 * the device's, not the language the reader chose in Homiio — so a Spanish user
 * on an English phone gets `1,234` where the rest of the screen says `1.234`.
 * The gate in `packages/frontend/__tests__/noHardcodedCurrency.test.ts` refuses
 * a locale-less `toLocaleString()`, and this is its sanctioned replacement for
 * quantities that are not money, area, distance or a percentage: a review count,
 * a city's population, a number of listings.
 */

/** Options accepted by {@link formatNumber}. */
export interface FormatNumberOptions {
  /** Minimum fraction digits. Defaults to `0`. */
  minimumFractionDigits?: number;
  /** Maximum fraction digits. Defaults to `0` — these are counts. */
  maximumFractionDigits?: number;
}

/**
 * Format `value` as a grouped number for `locale`.
 *
 * A non-finite value formats as `0`, and a malformed locale tag degrades to the
 * runtime default rather than throwing out of a render — the same contract as
 * every other formatter in this directory.
 */
export function formatNumber(
  value: number,
  locale: string,
  options: FormatNumberOptions = {},
): string {
  const minimumFractionDigits = options.minimumFractionDigits ?? 0;
  const intlOptions: Intl.NumberFormatOptions = {
    minimumFractionDigits,
    maximumFractionDigits: Math.max(minimumFractionDigits, options.maximumFractionDigits ?? 0),
  };
  const safeValue = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat(locale, intlOptions).format(safeValue);
  } catch {
    return new Intl.NumberFormat(undefined, intlOptions).format(safeValue);
  }
}
