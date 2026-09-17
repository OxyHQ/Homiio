/**
 * What the publish flow's preview and quality meter say about the form being
 * edited. Pure: the form in, Bloom `listing-editor` data out.
 *
 * The preview draws the listing the way the results grid will
 * (`PropertyCard`), and nothing more precise: the title generated the same way
 * the card's is, the location line as city and region — never the number or
 * unit the form also holds — the facts (the floor among them only when the host
 * published it), one price line per offering
 * in the listing's own currency, and the offerings as `OfferingBadge`s. No
 * rating and no badge: a draft has neither, and the card shows nothing rather
 * than an invented one.
 *
 * The quality checklist only counts things the form really holds, and every
 * row that is not done takes the host to the step that fixes it.
 */
import type { TFunction } from 'i18next';
import type { ListingPreviewData, ListingQualityItem } from '@oxy.so/bloom/listing-editor';
import type { Offering } from '@oxy.so/bloom/offering-badge';
import { OfferingType, PropertyType, formatArea, formatMoney } from '@homiio/shared-types';

import type { CreatePropertyFormData } from '@/store/createPropertyFormStore';
import type { Formatting } from '@/utils/format';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import {
  PROPERTY_FORM_DEFAULTS,
  validateLongTermPricingStep,
  validateNightlyPricingStep,
  validateSaleDetailsStep,
} from '@/utils/propertyFormSchema';
import {
  STEP_AMENITIES,
  STEP_BASIC_INFO,
  STEP_DESCRIPTION,
  STEP_LOCATION,
  STEP_MEDIA,
  STEP_PROPERTY_TYPE,
  STEP_LONG_TERM_PRICING,
  STEP_NIGHTLY_PRICING,
  STEP_OFFERING,
  STEP_SALE_DETAILS,
} from './constants';

/** Photos a complete listing carries. */
export const QUALITY_MIN_PHOTOS = 5;
/** Characters a complete description carries. */
export const QUALITY_MIN_DESCRIPTION = 120;

/** Homiio's offering axis → Bloom's offering vocabulary (the same four values). */
const BLOOM_OFFERING: Record<OfferingType, Offering> = {
  [OfferingType.LONG_TERM_RENT]: 'long_term_rent',
  [OfferingType.SHORT_TERM_RENT]: 'short_term_rent',
  [OfferingType.SALE]: 'sale',
  [OfferingType.EXCHANGE]: 'exchange',
};

/** The localized offering labels the badges draw (the same words the listing page uses). */
export function offeringLabels(t: TFunction): Record<Offering, string> {
  return {
    long_term_rent: t('listing.offering.summary.longTerm'),
    short_term_rent: t('listing.offering.summary.nightly'),
    sale: t('listing.offering.summary.sale'),
    exchange: t('listing.offering.summary.exchange'),
  };
}

export function draftPreviewData(
  form: CreatePropertyFormData,
  t: TFunction,
  formatting: Formatting,
): ListingPreviewData {
  const { basicInfo, location, pricing, offering, media } = form;
  const { locale, priceUnitLabels, areaUnitLabels } = formatting;
  const type = Object.values(PropertyType).includes(basicInfo.propertyType as PropertyType)
    ? (basicInfo.propertyType as PropertyType)
    : PropertyType.APARTMENT;

  const title = generatePropertyTitle(
    {
      type,
      address: {
        street: location.address,
        city: location.city,
        state: location.state,
        neighborhood: location.neighborhood,
      },
    },
    'short',
  );
  const place = [location.city, location.state].filter(Boolean).join(', ') || undefined;

  const facts: string[] = [];
  if (basicInfo.bedrooms) facts.push(t('listing.card.beds', { count: basicInfo.bedrooms }));
  if (basicInfo.bathrooms) facts.push(t('listing.card.baths', { count: basicInfo.bathrooms }));
  if (basicInfo.squareFootage > 0) {
    facts.push(formatArea(basicInfo.squareFootage, 'sqm', locale, { labels: areaUnitLabels }));
  }
  // The floor is a fact the listing page shows a visitor ONLY when the host made
  // it public — below `exact` the API leaves it off every non-owner response —
  // so the preview draws it under exactly the same condition.
  if (location.showFloor && location.floor !== undefined) {
    facts.push(`${t('property.sections.floor')} ${location.floor}`);
  }

  const currency = pricing.currency || 'USD';
  const offered = pricing.offerings;
  const priceLines: NonNullable<ListingPreviewData['priceLines']>[number][] = [];
  if (offered.includes(OfferingType.LONG_TERM_RENT) && pricing.monthlyRent > 0) {
    priceLines.push({
      price: formatMoney(pricing.monthlyRent, currency, locale),
      unit: priceUnitLabels.month.short,
    });
  }
  if (offered.includes(OfferingType.SHORT_TERM_RENT) && pricing.nightlyRate > 0) {
    priceLines.push({
      price: formatMoney(pricing.nightlyRate, currency, locale),
      unit: priceUnitLabels.night.short,
    });
  }
  if (offered.includes(OfferingType.SALE) && (offering.salePrice ?? 0) > 0) {
    priceLines.push({
      price: formatMoney(offering.salePrice ?? 0, offering.saleCurrency || currency, locale),
    });
  }
  if (offered.includes(OfferingType.EXCHANGE)) {
    priceLines.push({ price: t('listing.exchange.free') });
  }

  return {
    photos: (media.images ?? []).map((image) => image.urls.medium || image.urls.original),
    title,
    subtitle: place,
    dates: facts.length > 0 ? facts.join(' · ') : undefined,
    priceLines: priceLines.length > 0 ? priceLines : undefined,
    // The page preview draws a single price.
    price: priceLines[0]?.price,
    priceUnit: priceLines[0]?.unit,
    offerings: offered.map((value) => BLOOM_OFFERING[value]),
    offeringLabels: offeringLabels(t),
    description: basicInfo.description || undefined,
  };
}

/** Whether the location is a real pin rather than the form's Barcelona default. */
function hasPinnedLocation(location: CreatePropertyFormData['location']): boolean {
  const { latitude, longitude } = location;
  if (!latitude || !longitude) return false;
  return !(
    latitude === PROPERTY_FORM_DEFAULTS.DEFAULT_LATITUDE &&
    longitude === PROPERTY_FORM_DEFAULTS.DEFAULT_LONGITUDE
  );
}

/** The first priced step whose required price is missing, or `null` when every offering is priced. */
function unpricedStep(form: CreatePropertyFormData): string | null {
  const { offerings } = form.pricing;
  if (offerings.length === 0) return STEP_OFFERING;
  const checks: [OfferingType, string, () => object][] = [
    [OfferingType.LONG_TERM_RENT, STEP_LONG_TERM_PRICING, () => validateLongTermPricingStep(form.pricing)],
    [OfferingType.SHORT_TERM_RENT, STEP_NIGHTLY_PRICING, () => validateNightlyPricingStep(form.pricing)],
    [OfferingType.SALE, STEP_SALE_DETAILS, () => validateSaleDetailsStep(form.offering)],
  ];
  for (const [offering, step, validate] of checks) {
    if (offerings.includes(offering) && Object.keys(validate()).length > 0) return step;
  }
  return null;
}

export function draftQualityItems(
  form: CreatePropertyFormData,
  steps: readonly string[],
  goTo: (step: string) => void,
  t: TFunction,
): ListingQualityItem[] {
  const { basicInfo, location, amenities, media } = form;
  const link = (step: string) => (steps.includes(step) ? () => goTo(step) : undefined);
  const photos = media.images?.length ?? 0;
  const pricingStep = unpricedStep(form);

  const items: ListingQualityItem[] = [
    {
      key: 'type',
      label: t('propertyCreate.quality.type'),
      done: Boolean(basicInfo.propertyType),
      onPress: link(STEP_PROPERTY_TYPE),
    },
    {
      key: 'location',
      label: t('propertyCreate.quality.location'),
      done: hasPinnedLocation(location) && Boolean(location.city),
      onPress: link(STEP_LOCATION),
    },
    {
      key: 'pricing',
      label: t('propertyCreate.quality.pricing'),
      done: pricingStep === null,
      weight: 2,
      onPress: pricingStep ? link(pricingStep) : undefined,
    },
    {
      key: 'photos',
      label: t('propertyCreate.quality.photos', { count: QUALITY_MIN_PHOTOS }),
      done: photos >= QUALITY_MIN_PHOTOS,
      weight: 2,
      onPress: link(STEP_MEDIA),
    },
    {
      key: 'description',
      label: t('propertyCreate.quality.description', { count: QUALITY_MIN_DESCRIPTION }),
      done: (basicInfo.description?.trim().length ?? 0) >= QUALITY_MIN_DESCRIPTION,
      onPress: link(STEP_DESCRIPTION),
    },
    {
      key: 'area',
      label: t('propertyCreate.quality.area'),
      done: basicInfo.squareFootage > 0,
      onPress: link(STEP_BASIC_INFO),
    },
  ];
  // Amenities are only asked for property types whose flow has the step.
  if (steps.includes(STEP_AMENITIES)) {
    items.push({
      key: 'amenities',
      label: t('propertyCreate.quality.amenities'),
      done: (amenities.selectedAmenities?.length ?? 0) > 0,
      onPress: link(STEP_AMENITIES),
    });
  }
  // A done row has nowhere to send the host.
  return items.map((item) => (item.done ? { ...item, onPress: undefined } : item));
}

/** The meter's summary line, in the reader's language, by score band. */
export function qualitySummary(score: number, t: TFunction): string {
  if (score < 50) return t('propertyCreate.quality.needsWork');
  if (score < 80) return t('propertyCreate.quality.good');
  return t('propertyCreate.quality.excellent');
}
