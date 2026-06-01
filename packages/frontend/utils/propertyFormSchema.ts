import { z } from 'zod';
import type { CreatePropertyFormData } from '@/store/createPropertyFormStore';

/**
 * Zod schemas for the multi-step property creation wizard.
 *
 * These schemas mirror the per-step validation that previously lived inline in
 * `app/properties/create.tsx`. Validation is field-config aware: only fields
 * that are visible for the current property type/step (`fieldsToShow`) gate
 * progression. The schemas below therefore expose a `validate*` helper per step
 * that takes the visible fields and returns an error map keyed by field name,
 * exactly matching the previous behaviour (same keys, same messages, same
 * gating).
 */

const POSTAL_CODE_REGEX = /^\d{5}(-\d{4})?$/;
const DEFAULT_LATITUDE = 41.38723;
const DEFAULT_LONGITUDE = 2.16538;
const MIN_FLOOR = -5;
const MAX_FLOOR = 100;

export type StepValidationErrors = Record<string, string>;

/**
 * Bedroom/bathroom minimums per property type, matching the historical rules.
 * `min` is the inclusive lower bound; `message` is shown when the value is below
 * it. `undefined` means there is no type-specific minimum beyond presence.
 */
interface RoomRule {
  min: number;
  message: string;
}

interface RoomRules {
  bedrooms?: RoomRule;
  bathrooms?: RoomRule;
}

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

const ROOM_RULES: Record<string, RoomRules> = {
  apartment: {
    bedrooms: { min: 1, message: 'Apartments must have at least 1 bedroom' },
    bathrooms: { min: 1, message: 'Apartments must have at least 1 bathroom' },
  },
  house: {
    bedrooms: { min: 0, message: 'Houses can have 0 or more bedrooms' },
    bathrooms: { min: 1, message: 'Houses must have at least 1 bathroom' },
  },
  studio: {
    bedrooms: { min: 0, message: 'Studios can have 0 or more bedrooms' },
    bathrooms: { min: 1, message: 'Studios must have at least 1 bathroom' },
  },
  room: {
    bedrooms: { min: 1, message: 'Rooms must have at least 1 bedroom' },
    bathrooms: { min: 0, message: 'Rooms can have 0 or more bathrooms (shared or private)' },
  },
};

const buildDynamicRoomRules = (propertyType: string | undefined): RoomRules | undefined => {
  if (propertyType === 'duplex' || propertyType === 'penthouse') {
    const label = `${capitalize(propertyType)}s`;
    return {
      bedrooms: { min: 1, message: `${label} must have at least 1 bedroom` },
      bathrooms: { min: 1, message: `${label} must have at least 1 bathroom` },
    };
  }
  return undefined;
};

const isMissingNumber = (value: number | undefined | null): boolean =>
  value === undefined || value === null || Number.isNaN(value as number);

/**
 * Basic Info step. Mirrors the previous logic exactly: presence checks for the
 * visible fields, plus per-type bedroom/bathroom minimums.
 */
export function validateBasicInfoStep(
  basicInfo: CreatePropertyFormData['basicInfo'],
  fieldsToShow: readonly string[],
): StepValidationErrors {
  const errors: StepValidationErrors = {};

  if (fieldsToShow.includes('propertyType') && !basicInfo.propertyType) {
    errors.propertyType = 'Property type is required';
  }
  if (fieldsToShow.includes('bedrooms') && isMissingNumber(basicInfo.bedrooms)) {
    errors.bedrooms = 'Number of bedrooms is required';
  }
  if (fieldsToShow.includes('bathrooms') && isMissingNumber(basicInfo.bathrooms)) {
    errors.bathrooms = 'Number of bathrooms is required';
  }
  if (fieldsToShow.includes('squareFootage') && !basicInfo.squareFootage) {
    errors.squareFootage = 'Square footage is required';
  }

  const rules = ROOM_RULES[basicInfo.propertyType] ?? buildDynamicRoomRules(basicInfo.propertyType);
  if (rules) {
    if (
      rules.bedrooms &&
      fieldsToShow.includes('bedrooms') &&
      (isMissingNumber(basicInfo.bedrooms) || basicInfo.bedrooms < rules.bedrooms.min)
    ) {
      errors.bedrooms = rules.bedrooms.message;
    }
    if (
      rules.bathrooms &&
      fieldsToShow.includes('bathrooms') &&
      (isMissingNumber(basicInfo.bathrooms) || basicInfo.bathrooms < rules.bathrooms.min)
    ) {
      errors.bathrooms = rules.bathrooms.message;
    }
  }

  return errors;
}

const COORDINATES_ERROR = 'Please select a location on the map';

/**
 * Location step schema. Drives the required address fields and the postal-code
 * format. Coordinate presence is validated separately so that a missing
 * latitude/longitude collapses into a single `coordinates` error (matching the
 * historical UI), rather than two field errors.
 *
 * The trimmed string + `min(1)` rules reproduce the legacy `!value?.trim()`
 * checks, and the `superRefine` enforces the "required before format" ordering
 * for the postal code.
 */
export const locationStepSchema = z
  .object({
    address: z.string().trim().min(1, 'Street address is required'),
    city: z.string().trim().min(1, 'City is required'),
    state: z.string().trim().min(1, 'State is required'),
    postal_code: z.string(),
    country: z.string().trim().min(1, 'Country is required'),
  })
  .superRefine((value, ctx) => {
    const postal = value.postal_code?.trim() ?? '';
    if (!postal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['postal_code'],
        message: 'Postal code is required',
      });
    } else if (!POSTAL_CODE_REGEX.test(postal)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['postal_code'],
        message: 'Postal code must be in format 12345 or 12345-6789',
      });
    }
  });

export function validateLocationStep(
  location: CreatePropertyFormData['location'],
): StepValidationErrors {
  const errors: StepValidationErrors = {};

  const result = locationStepSchema.safeParse({
    address: location.address ?? '',
    city: location.city ?? '',
    state: location.state ?? '',
    postal_code: location.postal_code ?? '',
    country: location.country ?? '',
  });

  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      // Keep the first issue per field, matching the previous single-message UI.
      if (typeof field === 'string' && !errors[field]) {
        errors[field] = issue.message;
      }
    }
  }

  if (!location.latitude || !location.longitude) {
    errors.coordinates = COORDINATES_ERROR;
  }

  return errors;
}

const MAX_TAXES_PERCENT = 100;

/**
 * Offering selector. A listing must carry at least one offering (the selector
 * never lets the host drop the last one, but we validate defensively).
 */
export function validateOfferingStep(
  pricing: CreatePropertyFormData['pricing'],
): StepValidationErrors {
  const errors: StepValidationErrors = {};
  if (pricing.offerings.length === 0) {
    errors.offerings = 'Choose at least one way to offer this listing';
  }
  return errors;
}

/**
 * Long-term Pricing step. Reachable only when the listing is offered monthly,
 * so the monthly rent is required and must be positive (mirrors the backend's
 * `longTermRent.monthlyAmount > 0` rule).
 */
export function validateLongTermPricingStep(
  pricing: CreatePropertyFormData['pricing'],
): StepValidationErrors {
  const errors: StepValidationErrors = {};
  if (!pricing.monthlyRent || pricing.monthlyRent <= 0) {
    errors.monthlyRent = 'Monthly rent is required and must be greater than 0';
  }
  return errors;
}

/**
 * Nightly Pricing step. Reachable only when the listing is offered by the
 * night: the nightly rate must be positive, taxes 0–100, and (when both are
 * set) `minNights <= maxNights` (mirrors the backend's short-term rules).
 */
export function validateNightlyPricingStep(
  pricing: CreatePropertyFormData['pricing'],
): StepValidationErrors {
  const errors: StepValidationErrors = {};
  if (!pricing.nightlyRate || pricing.nightlyRate <= 0) {
    errors.nightlyRate = 'Nightly rate is required and must be greater than 0';
  }
  if (
    pricing.taxesPercent !== undefined &&
    (pricing.taxesPercent < 0 || pricing.taxesPercent > MAX_TAXES_PERCENT)
  ) {
    errors.taxesPercent = `Taxes must be between 0 and ${MAX_TAXES_PERCENT}%`;
  }
  if (
    pricing.minNights !== undefined &&
    pricing.maxNights !== undefined &&
    pricing.minNights > pricing.maxNights
  ) {
    errors.minNights = 'Minimum nights cannot exceed maximum nights';
  }
  return errors;
}

/**
 * Sale Details step. Only reachable when the listing is for sale, so the sale
 * price is required and must be positive (mirrors the backend's
 * `applyIntentRules` contract: a sale listing requires a positive `sale.price`).
 */
export function validateSaleDetailsStep(
  offering: CreatePropertyFormData['offering'],
): StepValidationErrors {
  const errors: StepValidationErrors = {};
  const price = offering.salePrice;
  if (price === undefined || Number.isNaN(price) || price <= 0) {
    errors.salePrice = 'Sale price is required and must be greater than 0';
  }
  return errors;
}

/**
 * Amenities step. Validates the combined amenities + rules: when guests are
 * allowed and the maxGuests field is visible, a minimum of 1 guest is required.
 */
export function validateAmenitiesStep(
  rules: CreatePropertyFormData['rules'],
  fieldsToShow: readonly string[],
): StepValidationErrors {
  const errors: StepValidationErrors = {};
  if (
    fieldsToShow.includes('maxGuests') &&
    rules.guestsAllowed &&
    (rules.maxGuests === undefined || rules.maxGuests < 1)
  ) {
    errors.maxGuests = 'Maximum guests must be at least 1';
  }
  return errors;
}

/**
 * Floor is optional. When provided it must be within the supported range.
 * Returns the error message, or null when valid.
 */
export function validateFloor(floor: number | undefined): string | null {
  if (floor === undefined) return null;
  if (floor < MIN_FLOOR || floor > MAX_FLOOR) {
    return `Please enter a valid floor number (${MIN_FLOOR} to ${MAX_FLOOR})`;
  }
  return null;
}

export const PROPERTY_FORM_DEFAULTS = {
  DEFAULT_LATITUDE,
  DEFAULT_LONGITUDE,
} as const;
