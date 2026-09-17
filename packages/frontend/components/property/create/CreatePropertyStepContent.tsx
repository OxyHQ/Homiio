import React, { type MutableRefObject } from 'react';
import type { MapApi, GeocodedAddress } from '@/components/Map';
import type { CreatePropertyFormData } from '@/store/createPropertyFormStore';
import type { StepValidationErrors } from '@/utils/propertyFormSchema';
import { BasicInfoStep } from './BasicInfoStep';
import { LocationStep } from './LocationStep';
import { OfferingSelector } from './OfferingSelector';
import { LongTermPricingStep } from './LongTermPricingStep';
import { NightlyPricingStep } from './NightlyPricingStep';
import { SaleDetailsStep } from './SaleDetailsStep';
import { ExchangeSettingsStep } from './ExchangeSettingsStep';
import { AmenitiesStep } from './AmenitiesStep';
import { ColivingFeaturesStep } from './ColivingFeaturesStep';
import { MediaStep } from './MediaStep';
import { PreviewStep } from './PreviewStep';
import {
  STEP_AMENITIES,
  STEP_BASIC_INFO,
  STEP_COLIVING,
  STEP_DESCRIPTION,
  STEP_LOCATION,
  STEP_MEDIA,
  STEP_PREVIEW,
  STEP_PROPERTY_TYPE,
  STEP_EXCHANGE_SETTINGS,
  STEP_LONG_TERM_PRICING,
  STEP_NIGHTLY_PRICING,
  STEP_OFFERING,
  STEP_SALE_DETAILS,
} from './constants';
import type { SetFormData, UpdateFormField } from './types';

interface CreatePropertyStepContentProps {
  stepName: string | undefined;
  formData: CreatePropertyFormData;
  validationErrors: StepValidationErrors;
  fieldsToShow: readonly string[];
  isLoading: boolean;
  submitError: string | null;
  railShowsPreview: boolean;
  mapRef: MutableRefObject<MapApi | null>;
  updateFormField: UpdateFormField;
  setFormData: SetFormData;
  onPropertyTypeChange: (typeId: string) => void;
  onAddressSelect: (address: GeocodedAddress, coordinates: [number, number]) => void;
  onOpenFullscreenMap: () => void;
  onFloorChange: (text: string) => void;
  onShowFloorToggle: (show: boolean) => void;
  onAmenityToggle: (amenityId: string) => void;
}

/**
 * Routes the active wizard step name to its step component. Keeps the screen a
 * thin orchestrator while preserving the exact previous step-by-name switch.
 */
export function CreatePropertyStepContent({
  stepName,
  formData,
  validationErrors,
  fieldsToShow,
  isLoading,
  submitError,
  railShowsPreview,
  mapRef,
  updateFormField,
  setFormData,
  onPropertyTypeChange,
  onAddressSelect,
  onOpenFullscreenMap,
  onFloorChange,
  onShowFloorToggle,
  onAmenityToggle,
}: CreatePropertyStepContentProps) {
  const sharedProps = {
    formData,
    validationErrors,
    fieldsToShow,
    updateFormField,
    setFormData,
  };

  switch (stepName) {
    // One component for the three steps about the home itself: each shows
    // only its own fields (`fieldsToShow`).
    case STEP_PROPERTY_TYPE:
    case STEP_BASIC_INFO:
    case STEP_DESCRIPTION:
      return <BasicInfoStep {...sharedProps} onPropertyTypeChange={onPropertyTypeChange} />;
    case STEP_LOCATION:
      return (
        <LocationStep
          {...sharedProps}
          mapRef={mapRef}
          onAddressSelect={onAddressSelect}
          onOpenFullscreenMap={onOpenFullscreenMap}
          onFloorChange={onFloorChange}
          onShowFloorToggle={onShowFloorToggle}
        />
      );
    case STEP_OFFERING:
      return <OfferingSelector {...sharedProps} />;
    case STEP_LONG_TERM_PRICING:
      return <LongTermPricingStep {...sharedProps} />;
    case STEP_NIGHTLY_PRICING:
      return <NightlyPricingStep {...sharedProps} />;
    case STEP_SALE_DETAILS:
      return <SaleDetailsStep {...sharedProps} />;
    case STEP_EXCHANGE_SETTINGS:
      return <ExchangeSettingsStep {...sharedProps} />;
    case STEP_AMENITIES:
      return <AmenitiesStep {...sharedProps} onAmenityToggle={onAmenityToggle} />;
    case STEP_COLIVING:
      return <ColivingFeaturesStep {...sharedProps} />;
    case STEP_MEDIA:
      return (
        <MediaStep formData={formData} updateFormField={updateFormField} isLoading={isLoading} />
      );
    case STEP_PREVIEW:
      return <PreviewStep submitError={submitError} railShowsPreview={railShowsPreview} />;
    default:
      return null;
  }
}
