import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Admonition } from '@oxy.so/bloom/admonition';
import { Button } from '@oxy.so/bloom/button';
import { ThemedText } from '@/components/ThemedText';
import { PropertyPreviewWidget } from '@/components/widgets/PropertyPreviewWidget';
import { createPropertyStyles as styles } from './styles';

interface PreviewStepProps {
  isLoading: boolean;
  isEditMode: boolean;
  isPropertyLoading: boolean;
  submitError: string | null;
  onSubmit: () => void;
}

/**
 * "Preview" wizard step: listing preview, submit button, and submission error.
 */
export function PreviewStep({
  isLoading,
  isEditMode,
  isPropertyLoading,
  submitError,
  onSubmit,
}: PreviewStepProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.step}>
      <ThemedText type="subtitle">Preview</ThemedText>
      <PropertyPreviewWidget />

      <View style={styles.submitContainer}>
        <ThemedText style={styles.helperText}>
          Review your property listing before submitting. Make sure all information is accurate and
          complete.
        </ThemedText>

        <Button
          onPress={onSubmit}
          loading={isLoading}
          disabled={isLoading || (isEditMode && isPropertyLoading)}
        >
          {isLoading
            ? isEditMode
              ? t('property.updating')
              : t('property.creating')
            : isEditMode
              ? t('property.update')
              : t('property.create')}
        </Button>

        {submitError && (
          <Admonition type="error">{t('property.error', { error: submitError })}</Admonition>
        )}
      </View>
    </View>
  );
}
