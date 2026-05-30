import { generatePropertyTitle, TitleFormat } from './propertyTitleGenerator';
import { Property, PropertyImage } from '@homiio/shared-types';
import propertyPlaceholder from '@/assets/images/property_placeholder.jpg';

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
