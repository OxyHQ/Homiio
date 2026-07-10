import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { toast } from '@/lib/sonner';
import i18next from 'i18next';
import {
  UtilitiesIncluded,
  PropertyStatus,
  OfferingType,
  type CreatePropertyData,
  type PropertyType,
  type Property,
  type PropertyImage,
  type PropertySale,
  type PropertyExchange,
  type LongTermRent,
  type ShortTermRent,
} from '@homiio/shared-types';
import {
  useCreatePropertyFormStore,
  type CreatePropertyFormData,
} from '@/store/createPropertyFormStore';
import { useReferralStore } from '@/store/referralStore';
import { propertyService } from '@/services/propertyService';
import { logger } from '@/utils/logger';

const DEFAULT_COUNTRY = 'US';
const DEFAULT_CURRENCY = 'USD';

/** Valid `PropertySale.chainStatus` values, used to narrow the stored string. */
const SALE_CHAIN_STATUSES: ReadonlySet<string> = new Set<
  NonNullable<PropertySale['chainStatus']>
>(['no_chain', 'chain', 'unknown']);

/** Narrow a stored chain-status string to the `PropertySale` union, or undefined. */
function toChainStatus(value: string | undefined): PropertySale['chainStatus'] | undefined {
  if (value !== undefined && SALE_CHAIN_STATUSES.has(value)) {
    return value as NonNullable<PropertySale['chainStatus']>;
  }
  return undefined;
}

/**
 * Payload sent to the property API. Extends `CreatePropertyData` with the
 * coliving features block that the wizard has always submitted for `coliving`
 * listings, and narrows `images` to the `{ url, caption, isPrimary }` object
 * form the wizard has always sent (both preserved verbatim from the previous
 * implementation; the backend accepts `PropertyImage[]` for `Property.images`).
 */
export type PropertySubmitPayload = Omit<CreatePropertyData, 'images'> & {
  images: PropertyImage[];
  status: PropertyStatus;
  colivingFeatures?: CreatePropertyFormData['colivingFeatures'];
  /**
   * Partner referral code captured when the owner reached the create flow via a
   * partner's link. Sent only when present so the backend can attribute the
   * listing to the sourcing partner; omitted entirely for un-referred listings.
   */
  referralCode?: string;
};

const toNumber = (
  value: number | undefined,
  parser: (input: string) => number,
): number | undefined => {
  if (value === undefined || value === null) return undefined;
  const parsed = parser(value.toString());
  return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * Builds the API payload from the wizard form state. The transformation matches
 * the previous inline `handleSubmit` logic exactly (same parsing, defaults, and
 * conditional coliving block), now strongly typed.
 */
export function buildPropertyPayload(formData: CreatePropertyFormData): PropertySubmitPayload {
  const { location, basicInfo, pricing, amenities, media, colivingFeatures, offering } = formData;

  const coordinates =
    location.latitude && location.longitude
      ? {
          type: 'Point' as const,
          coordinates: [location.longitude, location.latitude] as [number, number],
        }
      : undefined;

  const currency = pricing.currency || DEFAULT_CURRENCY;
  const offerings = pricing.offerings;

  const payload: PropertySubmitPayload = {
    address: {
      street: location.address,
      city: location.city,
      state: location.state,
      postal_code: location.postal_code,
      country: location.country || DEFAULT_COUNTRY,
      countryCode: location.countryCode || DEFAULT_COUNTRY,
      neighborhood: location.neighborhood,
      coordinates,
      number: location.number,
      building_name: location.building_name,
      block: location.block,
      entrance: location.entrance,
      unit: location.unit,
      subunit: location.subunit,
      district: location.district,
      address_lines: location.address_lines,
      po_box: location.po_box,
      reference: location.reference,
    },
    type: basicInfo.propertyType as PropertyType,
    description: basicInfo.description,
    bedrooms: toNumber(basicInfo.bedrooms, (v) => parseInt(v, 10)),
    bathrooms: toNumber(basicInfo.bathrooms, parseFloat),
    squareFootage: toNumber(basicInfo.squareFootage, (v) => parseInt(v, 10)),
    floor: toNumber(location.floor, (v) => parseInt(v, 10)),
    yearBuilt: toNumber(basicInfo.yearBuilt, (v) => parseInt(v, 10)),
    amenities: amenities.selectedAmenities || [],
    images:
      media.images?.map((img) => ({
        url: img.urls.original,
        caption: img.caption || '',
        isPrimary: img.isPrimary || false,
      })) ?? [],
    status: PropertyStatus.PUBLISHED,
    // The single offering axis — authoritative on the property. The server
    // validates it equals the set of present priced blocks below.
    offerings,
  };

  // Long-term (monthly) rent block — sent only when offered monthly. The
  // backend requires `monthlyAmount > 0` and a non-empty `currency`.
  if (offerings.includes(OfferingType.LONG_TERM_RENT)) {
    const longTermRent: LongTermRent = {
      monthlyAmount: pricing.monthlyRent ? parseFloat(pricing.monthlyRent.toString()) : 0,
      currency,
      deposit: pricing.securityDeposit
        ? parseFloat(pricing.securityDeposit.toString())
        : 0,
      // The wizard does not yet collect a utilities-included selection, so we
      // default to EXCLUDED (the host can refine it later via edit).
      utilities: UtilitiesIncluded.EXCLUDED,
    };
    if (pricing.applicationFee) {
      longTermRent.applicationFee = parseFloat(pricing.applicationFee.toString());
    }
    if (pricing.lateFee) {
      longTermRent.lateFee = parseFloat(pricing.lateFee.toString());
    }
    payload.longTermRent = longTermRent;
  }

  // Short-term (per-night) rent block — sent only when offered by the night.
  // The backend requires `nightlyRate > 0`; fees/taxes/min-max are optional.
  if (offerings.includes(OfferingType.SHORT_TERM_RENT)) {
    const shortTermRent: ShortTermRent = {
      nightlyRate: pricing.nightlyRate ? parseFloat(pricing.nightlyRate.toString()) : 0,
      currency,
      instantBook: pricing.instantBook,
    };
    if (pricing.cleaningFee) {
      shortTermRent.cleaningFee = parseFloat(pricing.cleaningFee.toString());
    }
    if (pricing.serviceFee) {
      shortTermRent.serviceFee = parseFloat(pricing.serviceFee.toString());
    }
    if (pricing.taxesPercent) {
      shortTermRent.taxesPercent = parseFloat(pricing.taxesPercent.toString());
    }
    if (pricing.minNights !== undefined) {
      shortTermRent.minNights = pricing.minNights;
    }
    if (pricing.maxNights !== undefined) {
      shortTermRent.maxNights = pricing.maxNights;
    }
    payload.shortTermRent = shortTermRent;
  }

  // Sale block — sent only when the listing is for sale. The backend requires a
  // positive `price` and a non-empty `currency`; `pricePerSqm` is derived
  // server-side from price + squareFootage, so we never send it.
  if (offerings.includes(OfferingType.SALE)) {
    const sale: PropertySale = {
      price: offering.salePrice ?? 0,
      currency: offering.saleCurrency || currency,
    };
    const chainStatus = toChainStatus(offering.chainStatus);
    if (chainStatus) {
      sale.chainStatus = chainStatus;
    }
    if (offering.isPriceReduced !== undefined) {
      sale.isPriceReduced = offering.isPriceReduced;
    }
    payload.sale = sale;
  }

  // Exchange block — sent only when the listing is open to exchange. `mode` and
  // `availabilityWindows` are always part of the shape; the rest are optional
  // and only included when set so we never overwrite stored data with blanks.
  if (offerings.includes(OfferingType.EXCHANGE)) {
    const exchange: PropertyExchange = {
      mode: offering.exchangeMode,
      availabilityWindows: offering.exchangeAvailabilityWindows,
      mealsIncluded: offering.exchangeMealsIncluded,
      requiresReciprocity: offering.exchangeRequiresReciprocity,
    };
    if (offering.exchangeMinStay !== undefined) {
      exchange.minStay = offering.exchangeMinStay;
    }
    if (offering.exchangeMaxStay !== undefined) {
      exchange.maxStay = offering.exchangeMaxStay;
    }
    const welcomeNote = offering.exchangeWelcomeNote?.trim();
    if (welcomeNote) {
      exchange.welcomeNote = welcomeNote;
    }
    if (offering.exchangeLanguages.length > 0) {
      exchange.languages = offering.exchangeLanguages;
    }
    payload.exchange = exchange;
  }

  if (basicInfo.propertyType === 'coliving') {
    payload.colivingFeatures = colivingFeatures;
  }

  return payload;
}

interface SubmitResult {
  property: Property;
  redirectId: string | null;
}

/**
 * Owns property creation/update submission as a React Query mutation. Replaces
 * the previous imperative `handleSubmit`: identical payload, identical
 * navigation, identical toasts, with the resulting error surfaced through the
 * form store (`error`) and consumed by the Preview step.
 */
export function useCreatePropertyWizard(id: string | undefined) {
  const router = useRouter();
  const isEditMode = Boolean(id);
  const { setLoading, setError } = useCreatePropertyFormStore();

  const { mutate, isPending } = useMutation<SubmitResult, Error>({
    mutationFn: async () => {
      const formData = useCreatePropertyFormStore.getState().formData;
      const payload = buildPropertyPayload(formData);

      if (isEditMode && id) {
        const property = await propertyService.updateProperty(id, payload);
        return { property, redirectId: id };
      }

      // Attribute a brand-new listing to the partner whose referral link the
      // owner arrived through (captured into the referral store on the create
      // screen). Only sent on create — an edit never carries a `ref` param.
      const referralCode = useReferralStore.getState().referralCode;
      const createPayload: PropertySubmitPayload = referralCode
        ? { ...payload, referralCode }
        : payload;

      const property = await propertyService.createProperty(createPayload);
      return { property, redirectId: property?._id ?? null };
    },
    onMutate: () => {
      setLoading(true);
      setError(null);
    },
    onSuccess: ({ property, redirectId }) => {
      if (!property || typeof property !== 'object') {
        setError(`Unexpected response format: ${JSON.stringify(property)}`);
        return;
      }
      if (isEditMode) {
        logger.info('Property update result', property);
        toast.success(i18next.t('property.toast.updateSuccess'));
        if (redirectId) {
          router.push(`/properties/${redirectId}`);
        } else {
          setError('Updated property but received unexpected response format');
        }
        return;
      }
      logger.info('Property creation result', property);
      toast.success(i18next.t('property.toast.createSuccess'));
      // The captured referral code has now been consumed by this listing —
      // clear it so a later, un-referred listing isn't mis-attributed.
      useReferralStore.getState().clearReferralCode();
      if (redirectId) {
        router.push(`/properties/${redirectId}`);
      } else {
        setError('Created property but received unexpected response format');
      }
    },
    onError: (error) => {
      const message =
        error instanceof Error
          ? error.message
          : i18next.t(isEditMode ? 'property.toast.updateFailed' : 'property.toast.createFailed');
      setError(message);
      toast.error(message);
    },
    onSettled: () => {
      setLoading(false);
    },
  });

  const handleSubmit = useCallback(() => {
    mutate();
  }, [mutate]);

  return {
    handleSubmit,
    isSubmitting: isPending,
  };
}
