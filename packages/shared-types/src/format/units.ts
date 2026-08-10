/**
 * Area and distance formatting.
 *
 * The invariant this module exists to hold: **the label always names the unit
 * the displayed number is actually in.** Homiio stores surface area in square
 * metres (every provider normalises to m², including the British ones that parse
 * `721 sq ft` out of a description and convert), so a screen printing
 * `{squareFootage} sq ft` is not a formatting nit — it states a flat is a
 * seventh of its real size. Conversion here is explicit, pure, and always
 * carries its label along with it.
 *
 * Storage is never reinterpreted. `formatArea` is told what the stored value IS
 * (`unit`) and, separately, what the reader would like to SEE (`preference`);
 * the two are different arguments precisely so that a device in the United
 * States cannot silently redefine what a stored `85` means.
 */

/** The unit a stored area value is expressed in. */
export type AreaUnit = 'sqm' | 'sqft';

/**
 * Which measurement system to render in.
 *
 * `auto` reads the REGION of the display locale — a presentation choice about
 * the reader, never a reinterpretation of the stored value.
 */
export type UnitPreference = 'metric' | 'imperial' | 'auto';

/** Square feet in one square metre (exact: 1 ft = 0.3048 m). */
const SQFT_PER_SQM = 10.763910416709722;

/** Metres in one mile (exact, by definition of the international foot). */
const METRES_PER_MILE = 1609.344;

/** Metres in one kilometre. */
const METRES_PER_KM = 1000;

/** Feet in one metre (exact: 1 ft = 0.3048 m). */
const FEET_PER_METRE = 3.280839895013123;

/**
 * Below this many metres a distance reads better in the small unit (metres or
 * feet) than as a fraction of the large one — `600 m` rather than `0.6 km`.
 */
const SMALL_DISTANCE_CUTOFF_METRES = METRES_PER_KM;

/**
 * Regions that measure everyday distance and floor area in customary units.
 * Deliberately short: the United States, Liberia and Myanmar. The United Kingdom
 * is NOT here — it signs roads in miles but sells flats in square metres, and
 * `auto` has to pick one system for both, so the conservative choice is metric
 * with an explicit `imperial` available to any surface that wants otherwise.
 */
const IMPERIAL_REGIONS: ReadonlySet<string> = new Set(['US', 'LR', 'MM']);

/**
 * The region subtag of a BCP-47 tag, uppercased, or `undefined` when the tag
 * carries none (`es`) or is malformed.
 *
 * Parsed by hand rather than through `Intl.Locale`, whose runtime availability
 * varies across the engines this package runs on (Hermes, Bun, Node); the
 * grammar needed here — a two-letter or three-digit subtag after the language,
 * skipping any script subtag — is small enough to read.
 */
function regionOf(locale: string): string | undefined {
  const subtags = locale.split(/[-_]/);
  for (let i = 1; i < subtags.length; i += 1) {
    const subtag = subtags[i];
    if (/^[A-Za-z]{2}$/.test(subtag)) return subtag.toUpperCase();
    if (/^[0-9]{3}$/.test(subtag)) return subtag;
    // A four-letter subtag is a script (`Latn`); keep looking past it.
    if (!/^[A-Za-z]{4}$/.test(subtag)) return undefined;
  }
  return undefined;
}

/** Resolve `auto` against the locale's region; anything else is taken as given. */
function resolveSystem(locale: string, preference: UnitPreference): 'metric' | 'imperial' {
  if (preference !== 'auto') return preference;
  const region = regionOf(locale);
  return region !== undefined && IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric';
}

/** How a unit is written beside its number. Maps to `Intl`'s `unitDisplay`. */
export type UnitDisplay = 'short' | 'narrow' | 'long';

/** Options accepted by {@link formatArea} and {@link formatDistance}. */
export interface FormatUnitOptions {
  /** `short` (default) renders `2,4 km`; `long` renders `2,4 kilómetros`. */
  unitDisplay?: UnitDisplay;
  /** Which system to render in. Defaults to `auto`. */
  preference?: UnitPreference;
}

/**
 * Literal suffixes used when `Intl` cannot name a unit itself.
 *
 * ECMA-402's sanctioned unit list has no `square-meter` or `square-foot` — only
 * simple units and `X-per-Y` compounds — so `style: 'unit'` REJECTS an area with
 * a `RangeError`. Area therefore always takes this path (the `m²`/`ft²` notation
 * is written the same way in every locale Homiio ships, so nothing is lost);
 * distance only falls back here if the engine or the locale tag is rejected.
 *
 * This is the one place allowed to hold a bare unit glyph, and it is a per-unit
 * constant rather than text glued onto an unformatted number — the number itself
 * still comes from `Intl.NumberFormat`.
 */
const FALLBACK_UNIT_SUFFIX = {
  kilometer: 'km',
  meter: 'm',
  mile: 'mi',
  foot: 'ft',
} as const;

/** A distance unit `Intl`'s `style: 'unit'` accepts. */
type MeasurementUnit = keyof typeof FALLBACK_UNIT_SUFFIX;

/** The written and spoken names of one {@link AreaUnit}. */
export interface AreaUnitLabel {
  /** Written after the number, e.g. `m²`. */
  short: string;
  /** Spoken in an accessibility label, e.g. `square metres`. */
  spoken: string;
}

/** Per-unit area wording, supplied by the caller's i18n layer. */
export type AreaUnitLabels = Readonly<Record<AreaUnit, AreaUnitLabel>>;

/** English wording used when a caller passes no `labels`. */
export const DEFAULT_AREA_UNIT_LABELS: AreaUnitLabels = {
  sqm: { short: 'm²', spoken: 'square metres' },
  sqft: { short: 'ft²', spoken: 'square feet' },
};

/** No-break space, so an area never wraps between its number and its unit. */
const AREA_UNIT_SEPARATOR = ' ';

/**
 * `value` rendered in `unit` for `locale`.
 *
 * `style: 'unit'` is ES2020 `Intl` and is what makes the unit word follow the
 * locale (`85 m²` / `85 pi²`). Engines that lack it, or a malformed locale tag,
 * fall back to a locale-formatted number plus the literal suffix — degraded, but
 * still grouped correctly and still labelled with the unit actually shown.
 */
function formatMeasurement(
  value: number,
  unit: MeasurementUnit,
  locale: string,
  unitDisplay: UnitDisplay,
  maximumFractionDigits: number,
): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  const options: Intl.NumberFormatOptions = {
    style: 'unit',
    unit,
    unitDisplay,
    maximumFractionDigits,
  };
  try {
    return new Intl.NumberFormat(locale, options).format(safeValue);
  } catch {
    // Either the locale tag or `style: 'unit'` was rejected. Try the default
    // locale before giving up on the unit word entirely.
    try {
      return new Intl.NumberFormat(undefined, options).format(safeValue);
    } catch {
      const digits = new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(
        safeValue,
      );
      return `${digits} ${FALLBACK_UNIT_SUFFIX[unit]}`;
    }
  }
}

/** Convert a stored area into the unit the chosen system renders in. */
function convertArea(value: number, from: AreaUnit, to: AreaUnit): number {
  if (from === to) return value;
  return to === 'sqft' ? value * SQFT_PER_SQM : value / SQFT_PER_SQM;
}

/** Options accepted by {@link formatArea} and {@link formatAreaLabel}. */
export interface FormatAreaOptions {
  /** Which system to render in. Defaults to `auto`. */
  preference?: UnitPreference;
  /** Localized unit wording; defaults to {@link DEFAULT_AREA_UNIT_LABELS}. */
  labels?: AreaUnitLabels;
}

/** The number and the unit an area resolves to, before either is joined. */
function resolveArea(
  value: number,
  unit: AreaUnit,
  locale: string,
  options: FormatAreaOptions,
): { digits: string; unit: AreaUnit } {
  const system = resolveSystem(locale, options.preference ?? 'auto');
  const target: AreaUnit = system === 'imperial' ? 'sqft' : 'sqm';
  const converted = convertArea(Number.isFinite(value) ? value : 0, unit, target);
  let digits: string;
  try {
    digits = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(converted);
  } catch {
    digits = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(converted);
  }
  return { digits, unit: target };
}

/**
 * Format a surface area, e.g. `85 m²`.
 *
 * `unit` names the unit `value` is STORED in; `options.preference` names the
 * system to display in. When they disagree the value is converted and the label
 * follows the conversion, so a square-metre figure can never appear beside a
 * square-foot label — the failure this module exists to make impossible.
 *
 * Rounded to whole units: Homiio's surfaces are whole square metres, and a
 * converted `914.7 ft²` implies a precision the source never had.
 */
export function formatArea(
  value: number,
  unit: AreaUnit,
  locale: string,
  options: FormatAreaOptions = {},
): string {
  const resolved = resolveArea(value, unit, locale, options);
  const labels = options.labels ?? DEFAULT_AREA_UNIT_LABELS;
  return `${resolved.digits}${AREA_UNIT_SEPARATOR}${labels[resolved.unit].short}`;
}

/**
 * The spoken form of an area, for `accessibilityLabel` — `85 square metres`
 * rather than `85 m²`, which a screen reader reads as "85 m two".
 */
export function formatAreaLabel(
  value: number,
  unit: AreaUnit,
  locale: string,
  options: FormatAreaOptions = {},
): string {
  const resolved = resolveArea(value, unit, locale, options);
  const labels = options.labels ?? DEFAULT_AREA_UNIT_LABELS;
  return `${resolved.digits} ${labels[resolved.unit].spoken}`;
}

/**
 * Format a distance given in METRES.
 *
 * Metres are the storage unit throughout (PostGIS distances, the nearby-services
 * radius), so the input unit is fixed and only the output varies. Short
 * distances render in the small unit whole (`600 m`, `1,969 ft`) and longer ones
 * in the large unit to one decimal (`2.4 km`, `1.5 mi`) — the same shape the
 * nearby-services list already used, generalised and localised.
 */
export function formatDistance(
  meters: number,
  locale: string,
  options: FormatUnitOptions = {},
): string {
  const safeMeters = Number.isFinite(meters) ? Math.max(meters, 0) : 0;
  const system = resolveSystem(locale, options.preference ?? 'auto');
  const unitDisplay = options.unitDisplay ?? 'short';

  if (system === 'imperial') {
    return safeMeters < METRES_PER_MILE
      ? formatMeasurement(safeMeters * FEET_PER_METRE, 'foot', locale, unitDisplay, 0)
      : formatMeasurement(safeMeters / METRES_PER_MILE, 'mile', locale, unitDisplay, 1);
  }
  return safeMeters < SMALL_DISTANCE_CUTOFF_METRES
    ? formatMeasurement(safeMeters, 'meter', locale, unitDisplay, 0)
    : formatMeasurement(safeMeters / METRES_PER_KM, 'kilometer', locale, unitDisplay, 1);
}
