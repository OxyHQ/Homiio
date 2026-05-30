import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '@/components/ThemedText';
import { Button } from '@oxyhq/bloom/button';
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
    <View>
      <ThemedText type="subtitle">Preview</ThemedText>
      <PropertyPreviewWidget />

      <View style={styles.submitContainer}>
        <ThemedText style={styles.helperText}>
          Review your property listing before submitting. Make sure all information is accurate and
          complete.
        </ThemedText>

        <Button onPress={onSubmit} disabled={isLoading || (isEditMode && isPropertyLoading)}>
          {isLoading
            ? isEditMode
              ? t('property.updating')
              : t('property.creating')
            : isEditMode
              ? t('property.update')
              : t('property.create')}
        </Button>

        {submitError && (
          <ThemedText style={styles.errorText}>
            {t('property.error', { error: submitError })}
          </ThemedText>
        )}
      </View>
    </View>
  );
}
