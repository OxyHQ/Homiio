import React, { type MutableRefObject } from 'react';
import { View } from 'react-native';
import type { MapApi, AddressData } from '@/components/Map';
import { ThemedText } from '@/components/ThemedText';
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
  isEditMode: boolean;
  isPropertyLoading: boolean;
  submitError: string | null;
  mapRef: MutableRefObject<MapApi | null>;
  updateFormField: UpdateFormField;
  setFormData: SetFormData;
  onPropertyTypeChange: (typeId: string) => void;
  onAddressSelect: (address: AddressData, coordinates: [number, number]) => void;
  onOpenFullscreenMap: () => void;
  onFloorChange: (text: string) => void;
  onShowFloorToggle: (show: boolean) => void;
  onAmenityToggle: (amenityId: string) => void;
  onSubmit: () => void;
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
  isEditMode,
  isPropertyLoading,
  submitError,
  mapRef,
  updateFormField,
  setFormData,
  onPropertyTypeChange,
  onAddressSelect,
  onOpenFullscreenMap,
  onFloorChange,
  onShowFloorToggle,
  onAmenityToggle,
  onSubmit,
}: CreatePropertyStepContentProps) {
  const sharedProps = {
    formData,
    validationErrors,
    fieldsToShow,
    updateFormField,
    setFormData,
  };

  switch (stepName) {
    case 'Basic Info':
      return <BasicInfoStep {...sharedProps} onPropertyTypeChange={onPropertyTypeChange} />;
    case 'Location':
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
    case 'Amenities':
      return <AmenitiesStep {...sharedProps} onAmenityToggle={onAmenityToggle} />;
    case 'Coliving Features':
      return <ColivingFeaturesStep {...sharedProps} />;
    case 'Media':
      return (
        <MediaStep formData={formData} updateFormField={updateFormField} isLoading={isLoading} />
      );
    case 'Preview':
      return (
        <PreviewStep
          isLoading={isLoading}
          isEditMode={isEditMode}
          isPropertyLoading={isPropertyLoading}
          submitError={submitError}
          onSubmit={onSubmit}
        />
      );
    default:
      return (
        <View>
          <ThemedText>Unknown step: {stepName}</ThemedText>
        </View>
      );
  }
}
