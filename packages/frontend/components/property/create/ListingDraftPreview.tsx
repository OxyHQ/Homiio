/**
 * The live preview and the quality checklist of the listing being published,
 * drawn with Bloom's `ListingPreviewPane` and `ListingQualityMeter` from the
 * form store — so the right rail and the Preview step read the same form and
 * say the same thing. The data they draw is `listingDraft.ts`'s.
 */
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ListingPreviewPane,
  ListingQualityMeter,
  listingQualityScore,
} from '@oxy.so/bloom/listing-editor';

import { useCreatePropertyFormStore } from '@/store/createPropertyFormStore';
import { useFormatting } from '@/utils/format';
import { DEFAULT_PROPERTY_TYPE, resolveStepFlow } from './constants';
import { draftPreviewData, draftQualityItems, qualitySummary } from './listingDraft';

export function ListingDraftPreview() {
  const { t } = useTranslation();
  const formatting = useFormatting();
  const formData = useCreatePropertyFormStore((state) => state.formData);
  const listing = useMemo(
    () => draftPreviewData(formData, t, formatting),
    [formData, t, formatting],
  );

  return (
    <ListingPreviewPane
      listing={listing}
      title={t('propertyCreate.preview.title')}
      description={t('propertyCreate.preview.description')}
      cardLabel={t('propertyCreate.preview.card')}
      pageLabel={t('propertyCreate.preview.page')}
      toggleLabel={t('propertyCreate.preview.toggle')}
      testID="create-property-preview"
    />
  );
}

export function ListingDraftQuality() {
  const { t } = useTranslation();
  const formData = useCreatePropertyFormStore((state) => state.formData);
  const setCurrentStep = useCreatePropertyFormStore((state) => state.setCurrentStep);
  const steps = useMemo(
    () =>
      resolveStepFlow(
        formData.basicInfo.propertyType || DEFAULT_PROPERTY_TYPE,
        formData.pricing.offerings,
      ),
    [formData.basicInfo.propertyType, formData.pricing.offerings],
  );
  const goTo = useCallback(
    (step: string) => {
      const index = steps.indexOf(step);
      if (index >= 0) setCurrentStep(index);
    },
    [steps, setCurrentStep],
  );
  const items = useMemo(
    () => draftQualityItems(formData, steps, goTo, t),
    [formData, steps, goTo, t],
  );
  const score = listingQualityScore(items);

  return (
    <ListingQualityMeter
      items={items}
      score={score}
      title={t('propertyCreate.quality.title')}
      summary={qualitySummary(score, t)}
      accessibilityLabel={t('propertyCreate.quality.title')}
      doneLabel={t('propertyCreate.quality.done')}
      todoLabel={t('propertyCreate.quality.todo')}
      testID="create-property-quality"
    />
  );
}
