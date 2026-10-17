/**
 * Money formatting — the ONE place a currency amount becomes user-visible text.
 *
 * Homiio ingests listings from every market its provider registry covers, so a
 * property's price arrives in PLN, RON, MXN, ARS or EUR and each one has its own
 * symbol, its own symbol POSITION and its own decimal/grouping separators.
 * Anything that builds a price by concatenation (`€${amount}`) is therefore
 * wrong for most of the catalogue, not merely unpolished — and it is wrong in
 * the direction that reads as plausible, which is why it survives review.
 *
 * The rules this module enforces, all of them from issue #357:
 *
 *  - **Never infer the currency from the locale.** A Polish listing shown to a
 *    Spanish user is still PLN. The entity's own currency wins, always; there is
 *    no code path here that reads the locale to decide what money something is.
 *  - **Never convert.** No exchange rate is consulted anywhere in this module.
 *    A converted figure needs a rate AND the timestamp it was taken at, which is
 *    a different feature (explicitly out of scope for #357).
 *  - **Never throw into a render.** `Intl` rejects a malformed currency code and
 *    a malformed locale with a `RangeError`. `LISTING_CURRENCIES` contains
 *    `FAIR` (FairCoin) — four characters, not ISO 4217 — so the unsupported-code
 *    path is REACHED BY REAL DATA, not a theoretical guard. It degrades to the
 *    grouped amount beside the raw code, which is still more useful than no
 *    price at all.
 *  - **Never infer the frequency from the screen.** {@link PriceDescriptor}
 *    carries the unit that belongs to the priced block it came from, so a
 *    monthly amount cannot render as a nightly one because of which tab is open.
 *
 * The module is pure and translation-agnostic: the per-unit words ("month",
 * "per month") are injected, mirroring how `resolvePrimaryOffering` takes its
 * `freeLabel`. English defaults ship here so a caller without i18n still reads
 * sensibly, exactly like `OFFERING_SUMMARY_META`'s `fallback` fields.
 */
import {
  formatMoney as formatOxyMoney,
  formatMoneyRange as formatOxyMoneyRange,
  isIsoCurrencyCode,
  type FormatMoneyOptions as OxyFormatMoneyOptions,
} from '@oxy.so/utils/currency';

import { PriceUnit } from '../common';

/**
 * How often a price is charged, spanning both the recurring units the property
 * model stores ({@link PriceUnit}) and the two non-recurring shapes the app also
 * renders: a booking's computed `total` (nightly rate × nights + fees) and a
 * `sale` asking price.
 *
 * `PriceUnit` deliberately has no `total`/`sale` member — it types a per-unit
 * rent block — so this is a superset rather than an alias. Use
 * {@link priceFrequencyFromPriceUnit} to widen a stored unit into it.
 */
export type PriceFrequency = 'night' | 'day' | 'week' | 'month' | 'year' | 'total' | 'sale';

/** Widen a stored {@link PriceUnit} into the display {@link PriceFrequency}. */
export function priceFrequencyFromPriceUnit(unit: PriceUnit): PriceFrequency {
  switch (unit) {
    case PriceUnit.DAY:
      return 'day';
    case PriceUnit.NIGHT:
      return 'night';
    case PriceUnit.WEEK:
      return 'week';
    case PriceUnit.MONTH:
      return 'month';
    case PriceUnit.YEAR:
      return 'year';
  }
}

/**
 * A price as the model actually holds it: an amount, the currency THAT amount is
 * denominated in, and the frequency that belongs to its priced block.
 *
 * Built from the real offering shapes rather than invented:
 * `LongTermRent{monthlyAmount, currency}` → `{unit:'month'}`,
 * `ShortTermRent{nightlyRate, currency}` → `{unit:'night'}`,
 * `PropertySale{price, currency}` → `{unit:'sale'}`, and a booking quote total →
 * `{unit:'total', includesMandatoryFees:true}`.
 */
export interface PriceDescriptor {
  amount: number;
  /** ISO 4217 code (or a non-ISO listing code such as `FAIR`; see the fallback). */
  currency: string;
  unit: PriceFrequency;
  /**
   * Whether cleaning/service fees and taxes are already inside `amount`. Set it
   * on a booking total so the UI can say so; leaving it undefined means "not
   * stated", which is NOT the same as `false`.
   */
  includesMandatoryFees?: boolean;
}

/** The visible suffix and the spoken form for one {@link PriceFrequency}. */
export interface PriceUnitLabel {
  /** Rendered after the amount, e.g. `month` in `1.700 € / month`. */
  short: string;
  /** Spoken in an accessibility label, e.g. `per month`. */
  spoken: string;
}

/** Per-frequency wording, supplied by the caller's i18n layer. */
export type PriceUnitLabels = Readonly<Record<PriceFrequency, PriceUnitLabel>>;

/**
 * English wording used when a caller passes no `unitLabels`. `sale` and `total`
 * are intentionally empty: an asking price takes no suffix, and a booking total
 * is labelled by the surrounding row rather than by a suffix on the number.
 */
export const DEFAULT_PRICE_UNIT_LABELS: PriceUnitLabels = {
  night: { short: 'night', spoken: 'per night' },
  day: { short: 'day', spoken: 'per day' },
  week: { short: 'week', spoken: 'per week' },
  month: { short: 'month', spoken: 'per month' },
  year: { short: 'year', spoken: 'per year' },
  total: { short: '', spoken: 'in total' },
  sale: { short: '', spoken: '' },
};

/** How the currency itself is written. Maps to `Intl`'s `currencyDisplay`. */
export type CurrencyDisplay = NonNullable<OxyFormatMoneyOptions['currencyDisplay']>;

/** Options accepted by {@link formatMoney}. */
export interface FormatMoneyOptions {
  /**
   * Minimum fraction digits. Defaults to `0` so a whole rent reads `1.700 €`
   * rather than `1.700,00 €` — four characters of nothing on the most
   * emphasised line of a card.
   */
  minimumFractionDigits?: number;
  /** Maximum fraction digits. Defaults to `2`. */
  maximumFractionDigits?: number;
  /**
   * `symbol` (default) for visible text; `name` for accessibility labels, which
   * spells the currency out ("1.700 euros") instead of leaving a screen reader
   * to guess at a glyph.
   */
  currencyDisplay?: CurrencyDisplay;
}

/**
 * Whether `Intl` will accept `code` as a currency — `FAIR` (four letters) and a
 * code the engine's ICU lacks are not. Oxy's shared `@oxy.so/utils/currency`.
 */
export function isSupportedCurrencyCode(code: string): boolean {
  return isIsoCurrencyCode(code.trim().toUpperCase());
}

/**
 * Format `amount` of `currency` for `locale` with Oxy's shared formatter
 * (`@oxy.so/utils/currency`), at Homiio's precision: whole amounts print no
 * decimals (`1.700 €`), anything else up to two.
 *
 * The locale decides the separators and where the symbol goes; the CURRENCY is
 * whatever the entity carries and is never derived from the locale. Nothing is
 * converted. A non-finite amount formats as `0`; an unsupported code (`FAIR`, a
 * typo) yields the grouped amount followed by the raw code.
 */
export function formatMoney(
  amount: number,
  currency: string,
  locale: string,
  options: FormatMoneyOptions = {},
): string {
  return formatOxyMoney(amount, currency, locale, homiioPrecision(options));
}

function homiioPrecision(options: FormatMoneyOptions): OxyFormatMoneyOptions {
  const minimumFractionDigits = options.minimumFractionDigits ?? 0;
  return {
    ...options,
    minimumFractionDigits,
    maximumFractionDigits: Math.max(minimumFractionDigits, options.maximumFractionDigits ?? 2),
  };
}

/** Options accepted by {@link formatPrice} and {@link formatPriceLabel}. */
export interface FormatPriceOptions extends FormatMoneyOptions {
  /** Localized per-unit wording; defaults to {@link DEFAULT_PRICE_UNIT_LABELS}. */
  unitLabels?: PriceUnitLabels;
}

/** Spacing around the `/` that separates an amount from its unit. */
const UNIT_SEPARATOR = ' / ';

/**
 * Format a {@link PriceDescriptor} as the headline text for a card, marker or
 * detail screen: the money in its own currency, followed by the unit the priced
 * block actually carries.
 *
 * `sale` and `total` render the bare amount — an asking price is not "per"
 * anything, and a booking total is described by its row rather than by a suffix.
 */
export function formatPrice(
  price: PriceDescriptor,
  locale: string,
  options: FormatPriceOptions = {},
): string {
  const money = formatMoney(price.amount, price.currency, locale, options);
  const labels = options.unitLabels ?? DEFAULT_PRICE_UNIT_LABELS;
  const suffix = labels[price.unit].short;
  return suffix ? `${money}${UNIT_SEPARATOR}${suffix}` : money;
}

/**
 * The spoken form of a {@link PriceDescriptor}, for `accessibilityLabel`.
 *
 * Spells the currency out (`currencyDisplay: 'name'` → "1.700 euros") and the
 * frequency too ("per month"), because a screen reader announcing "€" or a bare
 * "/" is exactly the ambiguity issue #357 asks to remove from price surfaces.
 */
export function formatPriceLabel(
  price: PriceDescriptor,
  locale: string,
  options: FormatPriceOptions = {},
): string {
  const money = formatMoney(price.amount, price.currency, locale, {
    ...options,
    currencyDisplay: 'name',
  });
  const labels = options.unitLabels ?? DEFAULT_PRICE_UNIT_LABELS;
  const spoken = labels[price.unit].spoken;
  return spoken ? `${money} ${spoken}` : money;
}

/**
 * Format a price range in one currency.
 *
 * Both ends are optional so an open-ended filter ("up to X", "from Y") can reuse
 * this: passing one end returns just that end formatted, leaving the caller's
 * i18n layer to supply the preposition rather than hardcoding an English word
 * here. Both ends absent yields `''`.
 */
export function formatMoneyRange(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string,
  locale: string,
  options: FormatMoneyOptions = {},
): string {
  return formatOxyMoneyRange(min, max, currency, locale, homiioPrecision(options));
}

/**
 * Format a deposit.
 *
 * A deposit is money like any other, so this is {@link formatMoney} with the
 * precision pinned to whole units: deposits in this app are stored as whole
 * amounts, and a stray `,50` on one would read as a data error. It exists as its
 * own name because issue #357 requires deposits, fees and ranges to come from
 * this module rather than from a local `${symbol}${amount}` at each call site.
 */
export function formatDeposit(amount: number, currency: string, locale: string): string {
  return formatMoney(amount, currency, locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
