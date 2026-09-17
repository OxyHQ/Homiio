/**
 * Eviction contact phone numbers as edited through Bloom's `PhoneInput`
 * (country select + national number), and back to the stored string.
 *
 * The stored value is free text: cases were created before the country select
 * existed, from anywhere, and many hold a number with no `+`. Guessing a dial
 * code for those would silently rewrite contact data on the next save, so a
 * field the user never touched is written back EXACTLY as it was read. A dial
 * code is only added to a number the user typed (or re-pointed at a country).
 *
 * Pure: no JSX, no hooks, no platform APIs — the device region is passed in.
 */
import { COUNTRIES, findCountry } from '@oxy.so/bloom/phone-input';

export interface EvictionPhoneValue {
  /** ISO 3166-1 alpha-2 shown in the country select. */
  country: string;
  /** What the number input shows. */
  number: string;
  /** The stored string this field was seeded from, verbatim (edit mode). */
  original: string | undefined;
  /** Whether the user changed the number or the country since it was seeded. */
  edited: boolean;
}

/**
 * The country select's last resort when neither the case's location nor the
 * device names a region. It matches `PhoneInput`'s own default, and it only
 * ever reaches the stored value through a number the user typed under it.
 */
export const FALLBACK_PHONE_COUNTRY = 'US';

/** An ISO code for a place given as a code or an English country name. */
export const countryCodeFromPlace = (place: string | undefined | null): string | undefined => {
  const value = place?.trim();
  if (!value) return undefined;
  if (value.length === 2) return findCountry(value)?.iso2;
  const lower = value.toLowerCase();
  return COUNTRIES.find((country) => country.name.toLowerCase() === lower)?.iso2;
};

/** The region of a BCP 47 tag (`es-ES` → `ES`), when it names one we list. */
export const regionFromLocaleTag = (tag: string | undefined | null): string | undefined => {
  const region = tag
    ?.split(/[-_]/)
    .slice(1)
    .find((part) => /^[A-Za-z]{2}$/.test(part));
  return region ? findCountry(region)?.iso2 : undefined;
};

/**
 * The country a phone field starts in: the case's own location first, then the
 * device's region, then {@link FALLBACK_PHONE_COUNTRY}. Never a hardcoded market.
 */
export const resolveDefaultPhoneCountry = (context: {
  /** The case's `location.countryCode`, when editing. */
  caseCountryCode?: string | null;
  /** A geocoded country (code or English name) from the picked address. */
  addressCountry?: string | null;
  /** The device region, e.g. `expo-localization`'s `regionCode`. */
  deviceRegion?: string | null;
  /** A locale tag to read a region from when the device gave none. */
  localeTag?: string | null;
}): string =>
  countryCodeFromPlace(context.caseCountryCode) ??
  countryCodeFromPlace(context.addressCountry) ??
  countryCodeFromPlace(context.deviceRegion) ??
  regionFromLocaleTag(context.localeTag) ??
  FALLBACK_PHONE_COUNTRY;

/**
 * Seed a field from a stored value. A `+<dial> …` value is split into its
 * country and number (longest dial code wins; on a shared code such as `+1`
 * the default country is preferred). Anything else is shown whole under the
 * default country — and, while untouched, saved back verbatim.
 */
export const splitEvictionPhone = (
  raw: string | undefined,
  defaultCountry: string,
): EvictionPhoneValue => {
  const value = (raw ?? '').trim();
  const unparsed: EvictionPhoneValue = {
    country: defaultCountry,
    number: value,
    original: raw,
    edited: false,
  };
  if (!value.startsWith('+')) return unparsed;
  const digits = value.slice(1).replace(/\D/g, '');
  const matches = COUNTRIES.filter((country) => digits.startsWith(country.dial));
  if (matches.length === 0) return unparsed;
  const longest = Math.max(...matches.map((country) => country.dial.length));
  const best = matches.filter((country) => country.dial.length === longest);
  const chosen = best.find((country) => country.iso2 === defaultCountry) ?? best[0];
  // Drop the dial code (and any separator right after it) from the shown text.
  let consumed = 0;
  let index = 1;
  while (index < value.length && consumed < chosen.dial.length) {
    if (/\d/.test(value[index])) consumed += 1;
    index += 1;
  }
  return { country: chosen.iso2, number: value.slice(index).trim(), original: raw, edited: false };
};

/** A new, empty field in `country`. */
export const emptyEvictionPhone = (country: string): EvictionPhoneValue => ({
  country,
  number: '',
  original: undefined,
  edited: false,
});

/** The field after the user typed `number`. */
export const withPhoneNumber = (value: EvictionPhoneValue, number: string): EvictionPhoneValue => ({
  ...value,
  number,
  edited: true,
});

/** The field after the user picked `country`. */
export const withPhoneCountry = (
  value: EvictionPhoneValue,
  country: string,
): EvictionPhoneValue => ({ ...value, country, edited: true });

/**
 * The string to store, or `undefined` for none.
 *
 * - Untouched: the seeded string, byte for byte (blank → `undefined`).
 * - Typed with its own `+`: kept as typed.
 * - Otherwise: `+<dial of the selected country> <number>`.
 */
export const joinEvictionPhone = (value: EvictionPhoneValue): string | undefined => {
  if (!value.edited) {
    return value.original !== undefined && value.original.trim() !== ''
      ? value.original
      : undefined;
  }
  const trimmed = value.number.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('+')) return trimmed;
  const dial = findCountry(value.country)?.dial;
  return dial ? `+${dial} ${trimmed}` : trimmed;
};
