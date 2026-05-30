import React, { useCallback, useState } from 'react';
import { View, ScrollView, TouchableOpacity, Platform, KeyboardAvoidingView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Header } from '@/components/Header';
import { ThemedText } from '@/components/ThemedText';
import { Button } from '@oxyhq/bloom/button';
import { StepsContainer } from '@/components/StepsContainer';
import type { AddressData } from '@/components/Map';
import { usePropertyCreateForm } from '@/hooks/usePropertyCreateForm';
import { useCreatePropertyWizard } from '@/hooks/useCreatePropertyWizard';
import {
  CreatePropertyStepContent,
  FullscreenMapModal,
  createPropertyStyles as styles,
} from '@/components/property/create';

/**
 * Multi-step property creation / edit wizard.
 *
 * This screen is a thin orchestrator: all form state lives in
 * `createPropertyFormStore` (Zustand), all logic lives in
 * `usePropertyCreateForm` (derived state, validation, side effects) and
 * `useCreatePropertyWizard` (submit mutation). Each step is a co-located
 * component under `components/property/create`.
 */
export default function CreatePropertyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const propertyId = typeof id === 'string' ? id : undefined;

  const {
    formData,
    currentStep,
    isLoading,
    submitError,
    steps,
    stepName,
    fieldsToShow,
    validationErrors,
    isEditMode,
    propertyLoading,
    propertyError,
    mapRef,
    fullscreenMapRef,
    setFormData,
    updateFormField,
    prevStep,
    applyAddressSelection,
    handleAddressSelect,
    handleShowFloorToggle,
    handleFloorChange,
    handleAmenityToggle,
    handlePropertyTypeChange,
    handleNextStep,
  } = usePropertyCreateForm(propertyId);

  const { handleSubmit } = useCreatePropertyWizard(propertyId);

  const [showFullscreenMap, setShowFullscreenMap] = useState(false);

  const openFullscreenMap = useCallback(() => setShowFullscreenMap(true), []);
  const closeFullscreenMap = useCallback(() => setShowFullscreenMap(false), []);

  const handleFullscreenAddressSelect = useCallback(
    (address: AddressData, coordinates: [number, number]) => {
      applyAddressSelection(address, coordinates);
      setShowFullscreenMap(false);
    },
    [applyAddressSelection],
  );

  // Show loading state when in edit mode and property is loading
  if (isEditMode && propertyLoading) {
    return (
      <View style={styles.container}>
        <Header options={{ title: 'Edit Property', showBackButton: true }} />
        <View style={styles.loadingContainer}>
          <ThemedText>Loading property...</ThemedText>
        </View>
      </View>
    );
  }

  // Show error state if property failed to load in edit mode
  if (isEditMode && propertyError) {
    return (
      <View style={styles.container}>
        <Header options={{ title: 'Edit Property', showBackButton: true }} />
        <View style={styles.errorContainer}>
          <ThemedText style={styles.errorText}>
            {t('property.loadError', { error: propertyError || t('property.notFound') })}
          </ThemedText>
          <TouchableOpacity style={styles.errorButton} onPress={() => router.back()}>
            <ThemedText style={styles.errorButtonText}>{t('common.goBack')}</ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <Header
        options={{ title: isEditMode ? 'Edit Property' : 'Create Property', showBackButton: true }}
      />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Step indicators */}
        <StepsContainer steps={steps} currentStep={currentStep} />

        {/* Form content */}
        <View style={styles.formContainer}>
          <CreatePropertyStepContent
            stepName={stepName}
            formData={formData}
            validationErrors={validationErrors}
            fieldsToShow={fieldsToShow}
            isLoading={isLoading}
            isEditMode={isEditMode}
            isPropertyLoading={propertyLoading}
            submitError={submitError}
            mapRef={mapRef}
            updateFormField={updateFormField}
            setFormData={setFormData}
            onPropertyTypeChange={handlePropertyTypeChange}
            onAddressSelect={handleAddressSelect}
            onOpenFullscreenMap={openFullscreenMap}
            onFloorChange={handleFloorChange}
            onShowFloorToggle={handleShowFloorToggle}
            onAmenityToggle={handleAmenityToggle}
            onSubmit={handleSubmit}
          />
        </View>

        {/* Navigation buttons */}
        <View style={styles.navigationContainer}>
          {currentStep > 0 && <Button onPress={prevStep}>{t('common.previous')}</Button>}

          {currentStep < steps.length - 1 && (
            <Button onPress={handleNextStep}>{t('common.next')}</Button>
          )}
        </View>
      </ScrollView>

      <FullscreenMapModal
        visible={showFullscreenMap}
        mapRef={fullscreenMapRef}
        onClose={closeFullscreenMap}
        onAddressSelect={handleFullscreenAddressSelect}
      />
    </KeyboardAvoidingView>
  );
}
