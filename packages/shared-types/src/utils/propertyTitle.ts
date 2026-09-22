/**
 * Property Title — shared pure core
 *
 * Dependency-free helpers used by both the frontend (i18n-aware) and backend
 * (plain-English) property title generators. This module must stay pure: no
 * i18n, no framework, no I/O. Each consumer layers its own type labels,
 * translations and address/geo extraction on top.
 */

export type PropertyTitleFormat = 'default' | 'short' | 'large';

/** Maximum length for short-format titles. */
export const SHORT_TITLE_MAX_LENGTH = 100;

/** Maximum length for large-format titles. */
export const LARGE_TITLE_MAX_LENGTH = 200;

/**
 * Location components used to resolve a display location for a title.
 * Names are display labels (already resolved), not IDs.
 */
export interface TitleLocationParts {
  /** Resolved neighborhood display name, if known. */
  neighborhood?: string;
  /** Street with the building number already stripped (privacy). */
  streetWithoutNumber?: string;
  city?: string;
  state?: string;
}

/**
 * Remove the building number (and anything after it) from a street for privacy.
 * Example: "Calle de Vicente Blasco Ibáñez, 6" → "Calle de Vicente Blasco Ibáñez".
 */
/**
 * The line terminators `.` does not match, which is what made the regex below
 * replaceable at all — see {@link removePropertyNumber}.
 */
const LINE_TERMINATORS = new Set(['\n', '\r', '\u2028', '\u2029']);

export function removePropertyNumber(street: string): string {
  if (!street) return '';

  // Was `street.replace(/,?\s*\d+.*$/, '')`, which is quadratic: the pattern is
  // unanchored, so `String.replace` retries it at EVERY index, and at each one
  // `\s*` walks the remaining whitespace run before `\d+` fails. 16k spaces took
  // 248ms, 32k a second. CodeQL: `js/polynomial-redos`.
  //
  // This is a PRIVACY function — it is what keeps a building number out of a
  // published title — so it reproduces the regex exactly rather than
  // approximating it with a bounded quantifier.
  //
  // REPRODUCING IT EXACTLY MEANS HONOURING `$`, WHICH IS THE PART A REWRITE
  // GETS WRONG. `.` does not match a line terminator and `$` (no `m` flag)
  // only matches at the very end, so `\d+.*$` can only succeed when the digits
  // lie on the LAST line. `"0\n"` therefore has no match at all and keeps its
  // digit. A first draft ignored this and disagreed with the regex on 75,582 of
  // 400,000 random strings; with the last-line rule it agrees on 800,000,
  // across `\r`, U+2028, U+2029 and non-breaking space.
  //
  // `\s*` may still cross line terminators, so the walk back is not confined to
  // the last line — only the digits are.
  let lastBreak = -1;
  for (let i = street.length - 1; i >= 0; i -= 1) {
    if (LINE_TERMINATORS.has(street[i])) { lastBreak = i; break; }
  }

  let firstDigit = -1;
  for (let i = lastBreak + 1; i < street.length; i += 1) {
    const code = street.charCodeAt(i);
    if (code >= 48 && code <= 57) { firstDigit = i; break; }
  }
  if (firstDigit === -1) return street.trim();

  // The regex takes the LEFTMOST match, which starts at the first digit walked
  // back over its whitespace run and then over one optional comma.
  let start = firstDigit;
  while (start > 0 && /\s/.test(street[start - 1])) start -= 1;
  if (start > 0 && street[start - 1] === ',') start -= 1;

  return street.slice(0, start).trim();
}

const NEIGHBORHOOD_PATTERNS: RegExp[] = [
  /carrer\s+(?:de\s+)?([^,\s]+)/i,
  /calle\s+(?:de\s+)?([^,\s]+)/i,
  /street\s+(?:of\s+)?([^,\s]+)/i,
  /avenue\s+(?:of\s+)?([^,\s]+)/i,
  /plaza\s+(?:de\s+)?([^,\s]+)/i,
  /passeig\s+(?:de\s+)?([^,\s]+)/i,
  /rambla\s+(?:de\s+)?([^,\s]+)/i,
];

const STREET_PREFIXES = ['carrer', 'calle', 'street', 'avenue', 'plaza', 'passeig', 'rambla'];

/**
 * Derive a neighborhood-like label from a street name (number already removed).
 * Tries common street-name patterns first ("Carrer de Gràcia" → "Gràcia"),
 * then falls back to the first meaningful comma-separated part.
 * Returns '' when nothing usable is found.
 */
export function extractNeighborhoodFromStreet(streetWithoutNumber: string): string {
  if (!streetWithoutNumber) return '';

  for (const pattern of NEIGHBORHOOD_PATTERNS) {
    const match = streetWithoutNumber.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  const streetParts = streetWithoutNumber.split(',').map((part) => part.trim());
  if (streetParts.length > 0) {
    const firstPart = streetParts[0];
    const lowerFirstPart = firstPart.toLowerCase();

    if (!STREET_PREFIXES.some((prefix) => lowerFirstPart.startsWith(prefix))) {
      return firstPart;
    }
    if (streetParts.length > 1) {
      return streetParts[1];
    }
    return streetWithoutNumber;
  }

  return '';
}

/**
 * Resolve the location segment for a SHORT title.
 * Preference order: explicit neighborhood → neighborhood derived from street →
 * city → state → `fallback`.
 */
export function resolveShortTitleLocation(parts: TitleLocationParts, fallback: string): string {
  if (parts.neighborhood) return parts.neighborhood;

  const fromStreet = extractNeighborhoodFromStreet(parts.streetWithoutNumber || '');
  if (fromStreet) return fromStreet;

  if (parts.city) return parts.city;
  if (parts.state) return parts.state;
  return fallback;
}

/**
 * Build the location segment for a LARGE title (full address, street numbers kept).
 * "street, city[, state]" → "city[, state]" → "state" → `fallback`.
 */
export function buildLargeTitleLocation(
  parts: Pick<TitleLocationParts, 'city' | 'state'> & { street?: string },
  fallback: string,
): string {
  const street = (parts.street || '').trim();

  if (street && parts.city) {
    let location = `${street}, ${parts.city}`;
    if (parts.state) location += `, ${parts.state}`;
    return location;
  }
  if (parts.city) {
    let location = parts.city;
    if (parts.state) location += `, ${parts.state}`;
    return location;
  }
  return parts.state || fallback;
}

/**
 * Compose `"{prefix} {location}"`, truncating the location so the full title
 * never exceeds `maxLength`.
 */
export function composeTitle(prefix: string, location: string, maxLength: number): string {
  const title = `${prefix} ${location}`;
  if (title.length <= maxLength) return title;

  const maxLocationLength = Math.max(maxLength - prefix.length - 1, 0);
  return `${prefix} ${location.substring(0, maxLocationLength).trim()}`;
}

/**
 * Build the "{n} bed(s), {m} bath(s)" suffix used by detailed titles.
 * Label wording (plain vs translated) is supplied by the caller.
 * Returns '' when there is nothing to append.
 */
export function buildTitleDetails(
  bedrooms: number,
  bathrooms: number,
  formatBedrooms: (count: number) => string,
  formatBathrooms: (count: number) => string,
): string {
  const details: string[] = [];
  if (bedrooms > 0) details.push(formatBedrooms(bedrooms));
  if (bathrooms > 0) details.push(formatBathrooms(bathrooms));
  return details.join(', ');
}
