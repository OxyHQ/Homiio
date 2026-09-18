/**
 * Shared form state for the write-review wizard. `write.tsx` owns one
 * `ReviewWizardData` object and a generic `update(field, value)`; each step
 * component reads + writes fields on it. Enum-typed fields stay optional (every
 * dimension step is skippable); only the hard-required fields are validated per
 * step in `write.tsx` before advancing.
 */
import { ReviewAuthorIdentity } from '@homiio/shared-types';
import type {
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
  ServiceType,
  TouristLevel,
  SecurityLevel,
} from '@homiio/shared-types';
import type { UploadedImage } from '@/services/imageUploadService';

export interface ReviewWizardData {
  // Address (nested address input resolved server-side).
  street: string;
  number: string;
  building_name: string;
  floor: string;
  unit: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  neighborhood: string;
  latitude?: number;
  longitude?: number;

  // Apartment dimensions.
  summerTemperature?: TemperatureRating;
  winterTemperature?: TemperatureRating;
  noise?: NoiseLevel;
  light?: LightLevel;
  conditionAndMaintenance?: ConditionRating;

  // Management.
  agencyName: string;
  landlordTreatment?: LandlordTreatment;
  problemResponse?: ResponseRating;
  depositReturned?: DepositReturn;
  adviceToAgency: string;
  adviceToLandlord: string;

  // Building.
  staircaseNeighbors?: NeighborRating;
  touristApartments?: boolean;
  neighborRelations?: NeighborRelations;
  cleaning?: CleaningRating;
  services: ServiceType[];

  // Area.
  areaTourists?: TouristLevel;
  areaNoise?: NoiseLevel;
  areaCleanliness?: CleaningRating;
  areaSecurity?: SecurityLevel;

  // Price & dates.
  price: string;
  currency: string;
  livedFrom: string;
  livedTo: string;

  // Texts.
  title: string;
  opinion: string;
  prosItems: string[];
  consItems: string[];

  // Photos & recommendation.
  images: UploadedImage[];
  rating: number;
  recommendation: boolean | null;

  /**
   * How the author wants to be published (ADR 0003 §5.2).
   *
   * Required rather than optional: the column has a default, but a form that
   * left this `undefined` would be one that never asked, and the whole point of
   * §5.2 is that the AUTHOR chooses.
   */
  authorIdentity: ReviewAuthorIdentity;
}

export const INITIAL_WIZARD_DATA: ReviewWizardData = {
  street: '',
  number: '',
  building_name: '',
  floor: '',
  unit: '',
  city: '',
  state: '',
  postal_code: '',
  country: '',
  neighborhood: '',
  latitude: undefined,
  longitude: undefined,
  summerTemperature: undefined,
  winterTemperature: undefined,
  noise: undefined,
  light: undefined,
  conditionAndMaintenance: undefined,
  agencyName: '',
  landlordTreatment: undefined,
  problemResponse: undefined,
  depositReturned: undefined,
  adviceToAgency: '',
  adviceToLandlord: '',
  staircaseNeighbors: undefined,
  touristApartments: undefined,
  neighborRelations: undefined,
  cleaning: undefined,
  services: [],
  areaTourists: undefined,
  areaNoise: undefined,
  areaCleanliness: undefined,
  areaSecurity: undefined,
  price: '',
  currency: 'EUR',
  livedFrom: '',
  livedTo: '',
  title: '',
  opinion: '',
  prosItems: [],
  consItems: [],
  images: [],
  rating: 0,
  recommendation: null,
  // `pseudonymous`, which is the column's default and the same departure from
  // ADR 0003 §5.2's own wording that `db/schema/reviews.ts` records: the ADR
  // offers `verified_anonymous_resident` by default, and its published text is
  // *"Verified resident"* while nothing in Homiio writes `reviews.verified`
  // (§6.1, F7). Offering it by default would ship a claim nobody checked.
  authorIdentity: ReviewAuthorIdentity.PSEUDONYMOUS,
};

/** Every step receives the current data + a typed field updater. */
export interface StepProps {
  data: ReviewWizardData;
  update: <K extends keyof ReviewWizardData>(field: K, value: ReviewWizardData[K]) => void;
}
