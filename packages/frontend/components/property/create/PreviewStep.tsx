import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Admonition } from '@oxy.so/bloom/admonition';
import { ListingDraftPreview, ListingDraftQuality } from './ListingDraftPreview';
import { createPropertyStyles as styles } from './styles';

interface PreviewStepProps {
  submitError: string | null;
  /** Whether this route has a right rail, which draws the preview from `lg`. */
  routeHasRail: boolean;
}

/**
 * "Preview" wizard step: the quality checklist, the listing preview (inline
 * except from `lg` on a route whose right rail draws it), and the submission error.
 * Publishing is the wizard footer's last-step action.
 */
export function PreviewStep({ submitError, routeHasRail }: PreviewStepProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.step}>
      {submitError ? (
        <Admonition type="error">
          {t('propertyCreate.submitError', { error: submitError })}
        </Admonition>
      ) : null}
      <View className={routeHasRail ? 'lg:hidden' : undefined}>
        <ListingDraftPreview />
      </View>
      <ListingDraftQuality />
    </View>
  );
}
