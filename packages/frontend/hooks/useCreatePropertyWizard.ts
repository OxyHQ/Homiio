import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  PaymentFrequency,
  UtilitiesIncluded,
  PropertyStatus,
  type CreatePropertyData,
  type PropertyType,
  type Property,
  type PropertyImage,
} from '@homiio/shared-types';
import {
  useCreatePropertyFormStore,
  type CreatePropertyFormData,
} from '@/store/createPropertyFormStore';
import { propertyService } from '@/services/propertyService';
import { logger } from '@/utils/logger';

const VALID_UTILITIES: readonly UtilitiesIncluded[] = [
  UtilitiesIncluded.INCLUDED,
  UtilitiesIncluded.EXCLUDED,
  UtilitiesIncluded.PARTIAL,
];

const DEFAULT_COUNTRY = 'US';
const DEFAULT_CURRENCY = 'USD';

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
};

const toNumber = (
  value: number | undefined,
  parser: (input: string) => number,
): number | undefined => {
  if (value === undefined || value === null) return undefined;
  const parsed = parser(value.toString());
  return Number.isNaN(parsed) ? undefined : parsed;
};

const resolveUtilities = (utilities: string[] | undefined): UtilitiesIncluded => {
  // Mirrors the legacy logic: the form stores utilities as an array, so the
  // `typeof === 'string'` guard never matches and the result is EXCLUDED.
  if (typeof utilities === 'string' && (VALID_UTILITIES as readonly string[]).includes(utilities)) {
    return utilities as UtilitiesIncluded;
  }
  return UtilitiesIncluded.EXCLUDED;
};

/**
 * Builds the API payload from the wizard form state. The transformation matches
 * the previous inline `handleSubmit` logic exactly (same parsing, defaults, and
 * conditional coliving block), now strongly typed.
 */
export function buildPropertyPayload(formData: CreatePropertyFormData): PropertySubmitPayload {
  const { location, basicInfo, pricing, amenities, media, colivingFeatures } = formData;

  const coordinates =
    location.latitude && location.longitude
      ? {
          type: 'Point' as const,
          coordinates: [location.longitude, location.latitude] as [number, number],
        }
      : undefined;

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
    rent: {
      amount: pricing.monthlyRent ? parseFloat(pricing.monthlyRent.toString()) : 0,
      currency: pricing.currency || DEFAULT_CURRENCY,
      paymentFrequency: PaymentFrequency.MONTHLY,
      deposit: pricing.securityDeposit ? parseFloat(pricing.securityDeposit.toString()) : 0,
      utilities: resolveUtilities(pricing.utilities),
    },
    amenities: amenities.selectedAmenities || [],
    images:
      media.images?.map((img) => ({
        url: img.urls.original,
        caption: img.caption || '',
        isPrimary: img.isPrimary || false,
      })) ?? [],
    status: PropertyStatus.PUBLISHED,
  };

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

      const property = await propertyService.createProperty(payload);
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
        toast.success('Property updated successfully');
        if (redirectId) {
          router.push(`/properties/${redirectId}`);
        } else {
          setError('Updated property but received unexpected response format');
        }
        return;
      }
      logger.info('Property creation result', property);
      toast.success('Property created successfully');
      if (redirectId) {
        router.push(`/properties/${redirectId}`);
      } else {
        setError('Created property but received unexpected response format');
      }
    },
    onError: (error) => {
      const message =
        error.message || (isEditMode ? 'Failed to update property' : 'Failed to create property');
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
