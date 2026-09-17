import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Admonition } from '@oxy.so/bloom/admonition';
import { ListingDraftPreview, ListingDraftQuality } from './ListingDraftPreview';
import { createPropertyStyles as styles } from './styles';

interface PreviewStepProps {
  submitError: string | null;
  /** Whether the right rail already draws the preview. */
  railShowsPreview: boolean;
}

/**
 * "Preview" wizard step: the quality checklist, the listing preview (inline
 * only when the right rail is not drawing it), and the submission error.
 * Publishing is the wizard footer's last-step action.
 */
export function PreviewStep({ submitError, railShowsPreview }: PreviewStepProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.step}>
      {submitError ? (
        <Admonition type="error">
          {t('propertyCreate.submitError', { error: submitError })}
        </Admonition>
      ) : null}
      {railShowsPreview ? null : <ListingDraftPreview />}
      <ListingDraftQuality />
    </View>
  );
}
