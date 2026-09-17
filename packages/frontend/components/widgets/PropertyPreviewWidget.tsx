/**
 * The publish flow's right rail: the live listing preview over the quality
 * checklist, both Bloom `listing-editor` parts drawn from the form store (see
 * `components/property/create/ListingDraftPreview`). On the Preview step the
 * checklist moves into the step itself, so the rail keeps only the preview;
 * below the rail's breakpoint the step draws both.
 */
import React from 'react';
import { View } from 'react-native';

import {
  DEFAULT_PROPERTY_TYPE,
  STEP_PREVIEW,
  resolveStepFlow,
} from '@/components/property/create/constants';
import {
  ListingDraftPreview,
  ListingDraftQuality,
} from '@/components/property/create/ListingDraftPreview';
import { useCreatePropertyFormStore } from '@/store/createPropertyFormStore';

export function PropertyPreviewWidget() {
  const onPreviewStep = useCreatePropertyFormStore((state) => {
    const steps = resolveStepFlow(
      state.formData.basicInfo.propertyType || DEFAULT_PROPERTY_TYPE,
      state.formData.pricing.offerings,
    );
    return steps[Math.min(state.currentStep, steps.length - 1)] === STEP_PREVIEW;
  });

  return (
    <View className="pointer-events-auto gap-6">
      <ListingDraftPreview />
      {onPreviewStep ? null : <ListingDraftQuality />}
    </View>
  );
}
