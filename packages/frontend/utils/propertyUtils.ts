import { generatePropertyTitle, TitleFormat } from './propertyTitleGenerator';
import {
  OfferingType,
  PriceUnit,
  Property,
  PropertyAddress,
  PropertyImage,
  type ImageVariantName,
} from '@homiio/shared-types';
import type { BrowseMode } from '@/components/search/types';
import propertyPlaceholder from '@/assets/images/property_placeholder.jpg';
import { resolveBackendImageUrl } from '@/utils/imageUrl';

/**
 * Image entry that may carry the full Sharp variant map (`urls`) from
 * {@link PropertyImageRef}. Legacy `{ url }` entries still work — `url` is the
 * medium variant.
 */
type PropertyImageEntry = PropertyImage & {
  urls?: Partial<Record<ImageVariantName, string>>;
};

/** The rental experience the user is currently browsing in. */
export type RentalMode = 'long_term' | 'vacation';

/** Which offering a card/headline is displaying. */
export type OfferingKind = 'long_term' | 'short_term' | 'sale' | 'exchange';

/**
 * The single, display-ready price decision for a property. `amount`/`currency`
 * feed `CurrencyFormatter`; `priceUnit` is the per-unit suffix (set for the rent
 * offerings — `month` for long-term, `night` for short-term; absent for sale);
 * `label` is a ready-to-render fallback string used when there is no numeric
 * price (exchange → "Free"). `kind` lets callers branch (e.g. render `label`
 * instead of `CurrencyFormatter` for an exchange).
 */
export interface PrimaryOffering {
  amount: number;
  currency: string;
  priceUnit?: PriceUnit;
  label: string;
  kind: OfferingKind;
}

/**
 * The set of offerings a listing carries. `offerings` is authoritative on the
 * Property; this guards against an undefined/empty array so callers can treat a
 * malformed listing as "no offerings" rather than crash.
 */
function offeringsOf(property: Property): readonly OfferingType[] {
  return Array.isArray(property.offerings) ? property.offerings : [];
}

/** Whether a property carries a given offering. */
export function hasOffering(property: Property, offering: OfferingType): boolean {
  return offeringsOf(property).includes(offering);
}

/** A listing is bookable as a short-stay iff it carries the short-term offering. */
export function isShortTermRentable(property: Property): boolean {
  return hasOffering(property, OfferingType.SHORT_TERM_RENT);
}

/** A listing carries a usable sale price when it's for sale with a positive price. */
function hasSalePrice(property: Property): boolean {
  return (
    hasOffering(property, OfferingType.SALE) &&
    typeof property.sale?.price === 'number' &&
    property.sale.price > 0
  );
}

/** A neutral, price-less offering (card/headline render nothing for it). */
function emptyOffering(kind: OfferingKind): PrimaryOffering {
  return { amount: 0, currency: '', priceUnit: undefined, label: '', kind };
}

/** The display-ready long-term (monthly) offering. */
function longTermOffering(property: Property): PrimaryOffering {
  const block = property.longTermRent;
  if (!block || !(block.monthlyAmount > 0)) return emptyOffering('long_term');
  return {
    amount: block.monthlyAmount,
    currency: block.currency || 'EUR',
    priceUnit: PriceUnit.MONTH,
    label: '',
    kind: 'long_term',
  };
}

/** The display-ready short-term (per-night) offering. */
function shortTermOffering(property: Property): PrimaryOffering {
  const block = property.shortTermRent;
  if (!block || !(block.nightlyRate > 0)) return emptyOffering('short_term');
  return {
    amount: block.nightlyRate,
    currency: block.currency || 'EUR',
    priceUnit: PriceUnit.NIGHT,
    label: '',
    kind: 'short_term',
  };
}

/** The display-ready sale offering (no per-unit suffix). */
function saleOffering(property: Property): PrimaryOffering {
  return {
    amount: property.sale?.price ?? 0,
    currency: property.sale?.currency ?? '',
    priceUnit: undefined,
    label: '',
    kind: 'sale',
  };
}

/**
 * Resolve the ONE primary price/offering a card or headline should display for
 * a (possibly multi-offering) listing, given the active {@link BrowseMode}.
 *
 * The unit is a fixed property of each priced block and is NEVER reinterpreted
 * by mode: long-term shows `/month`, short-term shows `/night`, sale shows the
 * asking price (no suffix), exchange shows the injected "Free" label.
 *
 *  - The active mode's block is read first (long_term → `longTermRent`,
 *    vacation → `shortTermRent`, buy → `sale`, exchange → free). If that block
 *    is absent, a neutral price-less offering is returned so the card shows NO
 *    misleading price rather than borrowing another offering's number.
 *  - As a graceful fallback ONLY when the listing doesn't carry the active
 *    offering at all (e.g. a rent-only listing surfaced in a buy feed), the
 *    first present priced block is shown in priority long-term → short-term →
 *    sale → exchange, so a card never renders blank for a real listing.
 *
 * `freeLabel` is injected by the caller (i18n: `listing.exchange.free`) so this
 * pure helper stays translation-agnostic.
 */
export function resolvePrimaryOffering(
  property: Property,
  browseMode: BrowseMode,
  freeLabel = 'Free',
): PrimaryOffering {
  const exchange = (): PrimaryOffering => ({
    amount: 0,
    currency: '',
    priceUnit: undefined,
    label: freeLabel,
    kind: 'exchange',
  });

  // Active mode's block — the unit is fixed per block, never reinterpreted.
  switch (browseMode) {
    case 'long_term':
      if (hasOffering(property, OfferingType.LONG_TERM_RENT)) return longTermOffering(property);
      break;
    case 'vacation':
      if (hasOffering(property, OfferingType.SHORT_TERM_RENT)) return shortTermOffering(property);
      break;
    case 'buy':
      if (hasOffering(property, OfferingType.SALE)) return saleOffering(property);
      break;
    case 'exchange':
      if (hasOffering(property, OfferingType.EXCHANGE)) return exchange();
      break;
  }

  // Fallback: the listing doesn't carry the active offering — surface the first
  // present priced block so a real listing never renders a blank price.
  if (hasOffering(property, OfferingType.LONG_TERM_RENT)) return longTermOffering(property);
  if (hasOffering(property, OfferingType.SHORT_TERM_RENT)) return shortTermOffering(property);
  if (hasSalePrice(property)) return saleOffering(property);
  if (hasOffering(property, OfferingType.EXCHANGE)) return exchange();

  // No recognised offering at all.
  return emptyOffering('long_term');
}

/**
 * A short, display-ready summary of a single offering, used by the "Also
 * available" line. `i18nKey` resolves via i18n at render time so this
 * pure helper stays translation-agnostic.
 */
export interface OfferingSummary {
  offering: OfferingType;
  i18nKey: string;
}

const OFFERING_SUMMARY_META: Record<OfferingType, { i18nKey: string }> = {
  [OfferingType.LONG_TERM_RENT]: { i18nKey: 'listing.offering.summary.longTerm' },
  [OfferingType.SHORT_TERM_RENT]: { i18nKey: 'listing.offering.summary.nightly' },
  [OfferingType.SALE]: { i18nKey: 'listing.offering.summary.sale' },
  [OfferingType.EXCHANGE]: { i18nKey: 'listing.offering.summary.exchange' },
};

/** Stable display order for the "Also available" summaries. */
const OFFERING_ORDER: readonly OfferingType[] = [
  OfferingType.LONG_TERM_RENT,
  OfferingType.SHORT_TERM_RENT,
  OfferingType.SALE,
  OfferingType.EXCHANGE,
];

/**
 * The OTHER offerings a multi-offering listing carries, excluding the one
 * currently shown as the headline (selected by {@link browseMode}). Drives the
 * subtle "Also available: By night · For sale" line on the card + detail.
 * Returns an empty array for single-offering listings.
 */
export function resolveOfferingSummaries(
  property: Property,
  browseMode: BrowseMode,
): OfferingSummary[] {
  const active = BROWSE_MODE_TO_OFFERING[browseMode];
  const present = offeringsOf(property);
  return OFFERING_ORDER.filter(
    (offering) => offering !== active && present.includes(offering),
  ).map((offering) => ({
    offering,
    i18nKey: OFFERING_SUMMARY_META[offering].i18nKey,
  }));
}

/**
 * Local 1:1 BrowseMode→OfferingType map. Duplicated from
 * `components/search/types` (rather than imported) so this pure utility has no
 * dependency cycle risk; kept tiny and asserted against the enum.
 */
const BROWSE_MODE_TO_OFFERING: Record<BrowseMode, OfferingType> = {
  long_term: OfferingType.LONG_TERM_RENT,
  vacation: OfferingType.SHORT_TERM_RENT,
  buy: OfferingType.SALE,
  exchange: OfferingType.EXCHANGE,
};

/**
 * A display-ready image source for `expo-image`/RN `Image`: either a remote URI
 * wrapper or the bundled placeholder asset (a module id `number` under Metro,
 * an object on web — both are valid `expo-image` sources, so we keep the union
 * loose enough to carry either without casting).
 */
export type ImageDisplaySource = { uri: string } | typeof propertyPlaceholder;

/**
 * Prefer `urls[variant]` when present, then fall back across the remaining
 * Sharp renditions, then the legacy medium `url`. Mirrors city cover resolution
 * in `cityDisplay.getCityImageSource`.
 */
const VARIANT_FALLBACK_ORDER: Record<ImageVariantName, ImageVariantName[]> = {
  small: ['small', 'medium', 'large', 'original'],
  medium: ['medium', 'large', 'small', 'original'],
  large: ['large', 'medium', 'small', 'original'],
  original: ['original', 'large', 'medium', 'small'],
};

function pickVariantUrl(
  entry: PropertyImageEntry,
  variant: ImageVariantName | undefined,
): string | undefined {
  const urls = entry.urls;
  if (urls && variant) {
    for (const name of VARIANT_FALLBACK_ORDER[variant]) {
      const candidate = urls[name];
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
      }
    }
  }
  return entry.url.length > 0 ? entry.url : undefined;
}

/**
 * Narrow a single image entry (URL string or `PropertyImage`) to its URL,
 * re-homing backend-served URLs onto the active API origin (see
 * {@link resolveBackendImageUrl}) so DB images that baked in a dev/emulator host
 * resolve on web/device/emulator alike. External/scraped URLs pass through.
 *
 * When `variant` is set and the entry carries `urls`, the matching Sharp
 * rendition is preferred (cards → medium/small, detail hero/lightbox → large).
 */
function imageEntryToUrl(
  entry: string | PropertyImageEntry,
  variant?: ImageVariantName,
): string | undefined {
  if (typeof entry === 'string') {
    return entry.length > 0 ? resolveBackendImageUrl(entry) : undefined;
  }
  if (entry && typeof entry === 'object' && 'url' in entry) {
    const raw = pickVariantUrl(entry, variant);
    return raw !== undefined ? resolveBackendImageUrl(raw) : undefined;
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
 * Resolve an address's display geo names into the shape the title generator
 * consumes. Geo is relational: the canonical city/region/country/neighborhood
 * NAMES are resolved server-side onto the serialized address as
 * `cityName`/`regionName`/`countryName`/`neighborhoodName` (the `*Id` fields are
 * ids, not human strings). This maps those resolved names onto the generator's
 * `{ city, state, country, neighborhood }` keys.
 */
function addressDisplayNames(address: PropertyAddress | undefined): {
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  neighborhood?: string;
} {
  return {
    street: address?.street,
    city: address?.cityName,
    state: address?.regionName,
    country: address?.countryName,
    neighborhood: address?.neighborhoodName,
  };
}

/**
 * A short, display-ready location label for a property (e.g. "Barcelona,
 * Catalonia"). Prefers the server-resolved `location` string, then composes from
 * the resolved city/region names, and returns an empty string when no geo name
 * resolved (so callers can choose their own placeholder).
 */
export function getPropertyLocationLabel(property: Property | undefined): string {
  const address = property?.address;
  if (!address) return '';
  if (address.location) return address.location;
  return [address.cityName, address.regionName].filter(Boolean).join(', ');
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
    address: addressDisplayNames(property.address),
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
 * @param variant - Optional Sharp rendition (`small` / `medium` / `large` / `original`).
 *   Defaults to the embedded medium `url` when omitted or when `urls` is absent.
 * @returns The property image source (remote URI wrapper or the bundled placeholder)
 */
export function getPropertyImageSource(
  property: Property | string[] | PropertyImage[] | string | PropertyImage | undefined,
  variant?: ImageVariantName,
): ImageDisplaySource {
  if (!property) {
    return propertyPlaceholder;
  }

  // If property is a single string URL
  if (typeof property === 'string') {
    const url = imageEntryToUrl(property, variant);
    return url !== undefined ? { uri: url } : propertyPlaceholder;
  }

  // If property is an array of images
  if (Array.isArray(property)) {
    return getPropertyImageSources(property, undefined, variant)[0];
  }

  // If property is a single PropertyImage object
  if ('url' in property) {
    const url = imageEntryToUrl(property, variant);
    return url !== undefined ? { uri: url } : propertyPlaceholder;
  }

  // If property is a Property object, honour the host's cover photo choice.
  if ('images' in property) {
    return getPropertyImageSources(property.images, property.coverImageIndex, variant)[0];
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
 * @param variant - Optional Sharp rendition for every entry (see
 *   {@link getPropertyImageSource}).
 */
export function getPropertyImageSources(
  images: Property['images'] | (string | PropertyImage)[] | undefined,
  coverIndex?: number,
  variant?: ImageVariantName,
): ImageDisplaySource[] {
  if (!images || images.length === 0) {
    return [propertyPlaceholder];
  }

  const sources = moveCoverToFront(images, coverIndex)
    .map((entry) => imageEntryToUrl(entry as string | PropertyImageEntry, variant))
    .filter((url): url is string => typeof url === 'string')
    .map((uri): ImageDisplaySource => ({ uri }));

  return sources.length > 0 ? sources : [propertyPlaceholder];
}
