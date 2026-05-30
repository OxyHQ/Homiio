import type { MutableRefObject } from 'react';
import type { MapApi } from '@/components/Map';
import type {
  CreatePropertyFormData,
  CreatePropertyFormSection,
} from '@/store/createPropertyFormStore';
import type { StepValidationErrors } from '@/utils/propertyFormSchema';

export type UpdateFormField = <S extends CreatePropertyFormSection>(
  section: S,
  field: keyof CreatePropertyFormData[S],
  value: CreatePropertyFormData[S][keyof CreatePropertyFormData[S]],
) => void;

export type SetFormData = <S extends CreatePropertyFormSection>(
  section: S,
  data: Partial<CreatePropertyFormData[S]>,
) => void;

/**
 * Props shared by every wizard step component. Each step reads its slice of
 * `formData`, reports `validationErrors`, and mutates state through the store
 * actions. Steps remain presentational; all orchestration lives in the
 * `usePropertyCreateForm` hook.
 */
export interface PropertyStepProps {
  formData: CreatePropertyFormData;
  validationErrors: StepValidationErrors;
  fieldsToShow: readonly string[];
  updateFormField: UpdateFormField;
  setFormData: SetFormData;
}

export interface LocationStepProps extends PropertyStepProps {
  mapRef: MutableRefObject<MapApi | null>;
  onAddressSelect: (
    address: import('@/components/Map').AddressData,
    coordinates: [number, number],
  ) => void;
  onOpenFullscreenMap: () => void;
  onFloorChange: (text: string) => void;
  onShowFloorToggle: (show: boolean) => void;
}

export interface AmenitiesStepProps extends PropertyStepProps {
  onAmenityToggle: (amenityId: string) => void;
}

export interface PreviewStepProps {
  isLoading: boolean;
  isEditMode: boolean;
  isPropertyLoading: boolean;
  createError: string | null;
  updateError: string | null;
  onSubmit: () => void;
}
