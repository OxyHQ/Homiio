import { generatePropertyTitle, TitleFormat } from './propertyTitleGenerator';
import { ListingIntent, PriceUnit, Property, PropertyImage } from '@homiio/shared-types';
import propertyPlaceholder from '@/assets/images/property_placeholder.jpg';

/** The rental experience the user is currently browsing in. */
export type RentalMode = 'long_term' | 'vacation';

/** Which offering a card/headline is displaying. */
export type OfferingKind = 'rent' | 'sale' | 'exchange';

/**
 * The single, display-ready price decision for a property. `amount`/`currency`
 * feed `CurrencyFormatter`; `priceUnit` is the per-unit suffix (only set for
 * rent — sale has none); `label` is a ready-to-render fallback string used when
 * there is no numeric price (exchange → "Free"). `kind` lets callers branch
 * (e.g. render `label` instead of `CurrencyFormatter` for an exchange).
 */
export interface PrimaryOffering {
  amount: number;
  currency: string;
  priceUnit?: PriceUnit;
  label: string;
  kind: OfferingKind;
}

/**
 * Whether a property carries a given intent. A listing with no stored `intents`
 * is treated as rent-only for back-compat (mirrors the backend + shared-types).
 */
function hasIntent(property: Property, intent: ListingIntent): boolean {
  const intents = property.intents;
  if (!Array.isArray(intents) || intents.length === 0) {
    return intent === ListingIntent.RENT;
  }
  return intents.includes(intent);
}

/**
 * Derive the displayed rent price unit for a property given the user's selected
 * rental mode. Vacation/both listings viewed in vacation mode always show
 * per-night pricing regardless of how the host stored the unit; long-term falls
 * back to the stored unit (typically MONTH). Centralised here so `PropertyCard`,
 * detail headlines, and any future surface share one rule.
 */
export function resolvePriceUnit(property: Property, mode: RentalMode): PriceUnit {
  if (mode === 'vacation') return PriceUnit.NIGHT;
  if (property.priceUnit) return property.priceUnit;
  return PriceUnit.MONTH;
}

/** A listing carries a usable sale price when it's for sale with a positive price. */
function hasSalePrice(property: Property): boolean {
  return (
    hasIntent(property, ListingIntent.SALE) &&
    typeof property.sale?.price === 'number' &&
    property.sale.price > 0
  );
}

/** The display-ready sale offering (no per-unit suffix). Caller guards validity. */
function saleOffering(property: Property): PrimaryOffering {
  return {
    amount: property.sale?.price ?? 0,
    currency: property.sale?.currency ?? '',
    priceUnit: undefined,
    label: '',
    kind: 'sale',
  };
}

/** The display-ready rent offering (mode-aware per-unit suffix). */
function rentOffering(property: Property, mode: RentalMode): PrimaryOffering {
  return {
    amount: property.rent?.amount ?? 0,
    currency: property.rent?.currency ?? 'EUR',
    priceUnit: resolvePriceUnit(property, mode),
    label: '',
    kind: 'rent',
  };
}

/**
 * Resolve the ONE primary price/offering a card or headline should display for
 * a (possibly multi-intent) listing. Priority is rent → sale → exchange:
 *
 *  - Rent (default, and any listing that includes the rent intent) keeps the
 *    EXISTING behaviour exactly — rent amount + per-unit suffix (mode-aware).
 *    This guarantees rent listings, including "rent + sell" ones, are visually
 *    unchanged; the "For sale" badge communicates the secondary sale intent.
 *    Exception: a rent listing with a non-positive rent that ALSO has a valid
 *    sale price falls through to the sale price, so the card shows the real
 *    asking price instead of a 0 the price gate would hide.
 *  - Sale-only listings show the sale price with NO per-unit suffix. When the
 *    sale block is missing or its price is non-positive, a neutral sale
 *    offering (empty label, `amount: 0`) is returned so the card shows NO
 *    misleading rent price rather than falling back to rent.
 *  - Exchange-only listings have no price → `label: 'Free'`, `kind: 'exchange'`.
 *
 * `freeLabel` is injected by the caller (i18n: `listing.exchange.free`) so this
 * pure helper stays translation-agnostic.
 */
export function resolvePrimaryOffering(
  property: Property,
  mode: RentalMode,
  freeLabel = 'Free',
): PrimaryOffering {
  // Rent takes precedence so existing rent (and rent+sale) cards are unchanged.
  if (hasIntent(property, ListingIntent.RENT)) {
    const rentAmount = property.rent?.amount ?? 0;
    // A rent listing whose rent isn't set yet but which has a real sale price
    // should surface that sale price, not a 0 the card would suppress.
    if (rentAmount <= 0 && hasSalePrice(property)) {
      return saleOffering(property);
    }
    return rentOffering(property, mode);
  }

  if (hasIntent(property, ListingIntent.SALE)) {
    // Sale-only: show the asking price when present; otherwise a neutral sale
    // offering (no price) — never a rent-priced fallback for a sale listing.
    return saleOffering(property);
  }

  if (hasIntent(property, ListingIntent.EXCHANGE)) {
    return { amount: 0, currency: '', priceUnit: undefined, label: freeLabel, kind: 'exchange' };
  }

  // Fallback: treat as rent (back-compat with listings that somehow carry no
  // recognised intent), preserving the prior rent-amount display.
  return rentOffering(property, mode);
}

/**
 * A display-ready image source for `expo-image`/RN `Image`: either a remote URI
 * wrapper or the bundled placeholder asset (a module id `number` under Metro,
 * an object on web — both are valid `expo-image` sources, so we keep the union
 * loose enough to carry either without casting).
 */
export type ImageDisplaySource = { uri: string } | typeof propertyPlaceholder;

/** Narrow a single image entry (URL string or `PropertyImage`) to its URL. */
function imageEntryToUrl(entry: string | PropertyImage): string | undefined {
  if (typeof entry === 'string') {
    return entry.length > 0 ? entry : undefined;
  }
  if (entry && typeof entry === 'object' && 'url' in entry) {
    return entry.url.length > 0 ? entry.url : undefined;
  }
  return undefined;
}

/**
 * Reorder a photo list so the host's chosen cover photo leads, mirroring how
 * Airbnb surfaces the cover image first. Returns the list unchanged when the
 * index is absent, non-integer, negative, zero (already first), or out of
 * range, so callers can pass `Property.coverImageIndex` straight through
 * without guarding it themselves. The relative order of the remaining photos
 * is preserved.
 */
function moveCoverToFront<T>(items: readonly T[], coverIndex: number | undefined): T[] {
  if (
    coverIndex === undefined ||
    !Number.isInteger(coverIndex) ||
    coverIndex <= 0 ||
    coverIndex >= items.length
  ) {
    return items.slice();
  }
  const cover = items[coverIndex];
  return [cover, ...items.slice(0, coverIndex), ...items.slice(coverIndex + 1)];
}

/**
 * Get the title for a property, generating it dynamically if needed
 * @param property - Property object
 * @param format - Title format ('default', 'short', or 'large')
 * @returns The property title
 */
export function getPropertyTitle(property: Property, format: TitleFormat = 'default'): string {
  return generatePropertyTitle({
    type: property.type,
    address: {
      ...property.address,
      // Use neighborhood field from address if available
      neighborhood: property.address.neighborhood,
    },
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
  }, format);
}

/**
 * Get a display-friendly property title for UI components
 * @param property - Property object
 * @returns The property title for display
 */
export function getDisplayPropertyTitle(property: Property): string {
  return getPropertyTitle(property, 'short');
}

/**
 * Get a detailed property title for property detail pages
 * @param property - Property object
 * @returns The detailed property title
 */
export function getDetailedPropertyTitle(property: Property): string {
  return getPropertyTitle(property, 'large');
}

/**
 * Get the single cover image source for a property, falling back to the bundled
 * placeholder when no usable image is available. Suitable directly as an
 * `Image`/`expo-image` `source` prop.
 *
 * When given a full `Property`, the host's `coverImageIndex` (when valid) selects
 * the cover photo; otherwise the first photo leads. Callers that pass a single
 * image or a bare array are unaffected by cover ordering — there is no `Property`
 * to read the index from.
 *
 * @param property - Property object, images array (string[] or PropertyImage[]), or single image (string or PropertyImage)
 * @returns The property image source (remote URI wrapper or the bundled placeholder)
 */
export function getPropertyImageSource(
  property: Property | string[] | PropertyImage[] | string | PropertyImage | undefined,
): ImageDisplaySource {
  if (!property) {
    return propertyPlaceholder;
  }

  // If property is a single string URL
  if (typeof property === 'string') {
    const url = imageEntryToUrl(property);
    return url !== undefined ? { uri: url } : propertyPlaceholder;
  }

  // If property is an array of images
  if (Array.isArray(property)) {
    return getPropertyImageSources(property)[0];
  }

  // If property is a single PropertyImage object
  if ('url' in property) {
    const url = imageEntryToUrl(property);
    return url !== undefined ? { uri: url } : propertyPlaceholder;
  }

  // If property is a Property object, honour the host's cover photo choice.
  if ('images' in property) {
    return getPropertyImageSources(property.images, property.coverImageIndex)[0];
  }

  return propertyPlaceholder;
}

/**
 * Resolve the full ordered list of display sources for a property's photos.
 *
 * Unlike {@link getPropertyImageSource} (which returns only the cover image),
 * this returns every usable photo as a typed `expo-image` source, ready to feed
 * a swipeable carousel. Entries with empty/invalid URLs are dropped. When a
 * property has no usable photos, a single-element array holding the bundled
 * placeholder is returned so callers always have at least one page to render.
 *
 * When `coverIndex` points at a valid entry in the *original* `images` list,
 * that photo is moved to the front (Airbnb-style cover-first) before invalid
 * entries are dropped, so the host's chosen cover leads regardless of where it
 * sits in the array. An absent/out-of-range index leaves the order untouched.
 *
 * @param images - A property's `images` field, a pre-built image array, or undefined.
 * @param coverIndex - Optional index into `images` of the host's cover photo
 *   (`Property.coverImageIndex`). Ignored when undefined/non-integer/out of range.
 */
export function getPropertyImageSources(
  images: Property['images'] | (string | PropertyImage)[] | undefined,
  coverIndex?: number,
): ImageDisplaySource[] {
  if (!images || images.length === 0) {
    return [propertyPlaceholder];
  }

  const sources = moveCoverToFront(images, coverIndex)
    .map(imageEntryToUrl)
    .filter((url): url is string => typeof url === 'string')
    .map((uri): ImageDisplaySource => ({ uri }));

  return sources.length > 0 ? sources : [propertyPlaceholder];
}
