/**
 * Dimension metadata shared by the review read surfaces — the `ReviewCard`
 * dimension chips, the address-page per-section breakdown, and the section
 * filters. ONE source of truth for "which review fields belong to which section
 * and how to label them" so the card and the address tabs never drift.
 */
import {
  TemperatureRating,
  NoiseLevel,
  LightLevel,
  ConditionRating,
  LandlordTreatment,
  ResponseRating,
  DepositReturn,
  NeighborRating,
  NeighborRelations,
  CleaningRating,
  TouristLevel,
  SecurityLevel,
  ServiceType,
  type ReviewDTO,
} from '@homiio/shared-types';

export type ReviewSection = 'apartment' | 'management' | 'building' | 'area';

export interface DimensionDescriptor {
  /** The review field this dimension reads. */
  field: keyof ReviewDTO;
  /** i18n key for the dimension's label (reuses the wizard field labels). */
  labelKey: string;
  /** i18n key prefix for the dimension's enum-value labels. */
  enumPrefix: string;
  /** Ordered enum values (drives distribution row ordering). */
  values: readonly string[];
}

export const APARTMENT_DIMENSIONS: DimensionDescriptor[] = [
  { field: 'summerTemperature', labelKey: 'reviews.write.fields.summerTemperature', enumPrefix: 'reviews.enums.temperature', values: Object.values(TemperatureRating) },
  { field: 'winterTemperature', labelKey: 'reviews.write.fields.winterTemperature', enumPrefix: 'reviews.enums.temperature', values: Object.values(TemperatureRating) },
  { field: 'noise', labelKey: 'reviews.write.fields.noise', enumPrefix: 'reviews.enums.noise', values: Object.values(NoiseLevel) },
  { field: 'light', labelKey: 'reviews.write.fields.light', enumPrefix: 'reviews.enums.light', values: Object.values(LightLevel) },
  { field: 'conditionAndMaintenance', labelKey: 'reviews.write.fields.conditionAndMaintenance', enumPrefix: 'reviews.enums.condition', values: Object.values(ConditionRating) },
];

export const MANAGEMENT_DIMENSIONS: DimensionDescriptor[] = [
  { field: 'landlordTreatment', labelKey: 'reviews.write.fields.landlordTreatment', enumPrefix: 'reviews.enums.landlordTreatment', values: Object.values(LandlordTreatment) },
  { field: 'problemResponse', labelKey: 'reviews.write.fields.problemResponse', enumPrefix: 'reviews.enums.problemResponse', values: Object.values(ResponseRating) },
  { field: 'depositReturned', labelKey: 'reviews.write.fields.depositReturned', enumPrefix: 'reviews.enums.depositReturned', values: Object.values(DepositReturn) },
];

export const BUILDING_DIMENSIONS: DimensionDescriptor[] = [
  { field: 'staircaseNeighbors', labelKey: 'reviews.write.fields.staircaseNeighbors', enumPrefix: 'reviews.enums.staircaseNeighbors', values: Object.values(NeighborRating) },
  { field: 'neighborRelations', labelKey: 'reviews.write.fields.neighborRelations', enumPrefix: 'reviews.enums.neighborRelations', values: Object.values(NeighborRelations) },
  { field: 'cleaning', labelKey: 'reviews.write.fields.cleaning', enumPrefix: 'reviews.enums.cleaning', values: Object.values(CleaningRating) },
];

export const AREA_DIMENSIONS: DimensionDescriptor[] = [
  { field: 'areaTourists', labelKey: 'reviews.write.fields.areaTourists', enumPrefix: 'reviews.enums.areaTourists', values: Object.values(TouristLevel) },
  { field: 'areaNoise', labelKey: 'reviews.write.fields.areaNoise', enumPrefix: 'reviews.enums.noise', values: Object.values(NoiseLevel) },
  { field: 'areaCleanliness', labelKey: 'reviews.write.fields.areaCleanliness', enumPrefix: 'reviews.enums.cleaning', values: Object.values(CleaningRating) },
  { field: 'areaSecurity', labelKey: 'reviews.write.fields.areaSecurity', enumPrefix: 'reviews.enums.areaSecurity', values: Object.values(SecurityLevel) },
];

export const SERVICE_VALUES: readonly string[] = Object.values(ServiceType);

export const SECTION_DIMENSIONS: Record<ReviewSection, DimensionDescriptor[]> = {
  apartment: APARTMENT_DIMENSIONS,
  management: MANAGEMENT_DIMENSIONS,
  building: BUILDING_DIMENSIONS,
  area: AREA_DIMENSIONS,
};

/** True when the review carries at least one field belonging to `section`. */
export function reviewHasSection(review: ReviewDTO, section: ReviewSection): boolean {
  const hasEnum = SECTION_DIMENSIONS[section].some((dimension) => {
    const raw = review[dimension.field];
    return typeof raw === 'string' && raw.length > 0;
  });
  if (hasEnum) return true;
  if (section === 'building') {
    return (
      typeof review.touristApartments === 'boolean' ||
      (Array.isArray(review.services) && review.services.length > 0)
    );
  }
  return false;
}
