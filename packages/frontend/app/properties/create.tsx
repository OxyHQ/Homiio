import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, Platform, KeyboardAvoidingView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Header } from '@/components/Header';
import { useReferralStore } from '@/store/referralStore';
import { useCreatePropertyFormStore } from '@/store/createPropertyFormStore';
import { Admonition } from '@oxy.so/bloom/admonition';
import { Button } from '@oxy.so/bloom/button';
import { RiArrowLeftLine } from '@oxy.so/bloom/icons';
import { Loading } from '@oxy.so/bloom/loading';
import { useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { WizardFooter, WizardProgress, type WizardStep } from '@oxy.so/bloom/wizard';
import type { GeocodedAddress } from '@/components/Map';
import { useHasRightBar } from '@/components/RightBar';
import { useIsRightBarVisible } from '@/hooks/useOptimizedMediaQuery';
import { usePropertyCreateForm } from '@/hooks/usePropertyCreateForm';
import { useCreatePropertyWizard } from '@/hooks/useCreatePropertyWizard';
import { logger } from '@/utils/logger';
import { deleteDraft, newDraftId, saveDraft, takeDraftToResume } from '@/utils/propertyDrafts';
import {
  CreatePropertyStepContent,
  FullscreenMapModal,
  STEP_COPY,
  createPropertyStyles as styles,
} from '@/components/property/create';

/**
 * Multi-step property creation / edit flow on Bloom's `wizard` and
 * `listing-editor` families.
 *
 * This screen is a thin orchestrator: all form state lives in
 * `createPropertyFormStore` (Zustand), all logic lives in
 * `usePropertyCreateForm` (derived state, validation, side effects) and
 * `useCreatePropertyWizard` (submit mutation — the request body is
 * `buildPropertyPayload`'s, unchanged). Each step is a co-located component
 * under `components/property/create`.
 *
 * Frame: `WizardProgress` names the step at the top of the scroll, and
 * `WizardFooter` (Back / Next, Publish on the last step) sits after the scroll
 * view, so it stays put on native and is sticky on web. The live preview and
 * the quality checklist are the right rail's (`PropertyPreviewWidget`); below
 * the rail's breakpoint the Preview step draws them.
 *
 * Drafts: advancing a step saves the form to the named, listable draft
 * (`utils/propertyDrafts`, what `/properties/drafts` shows), as does the "Save
 * draft" action; publishing deletes it. New listings only — an edit is not a
 * draft of anything.
 *
 * That is not what protects work in progress. The form store persists itself on
 * every change, so an interruption — backgrounding, a reload, a crash — restores
 * both what was typed and the step it was typed on, for edits as well as new
 * listings. See `store/createPropertyFormStore`.
 */
export default function CreatePropertyScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { id, ref } = useLocalSearchParams();
  const propertyId = typeof id === 'string' ? id : undefined;
  const scrollRef = useRef<ScrollView | null>(null);

  // Capture a partner referral code carried on the create-property link
  // (`…/properties/create?ref=<code>`) into the persisted referral store. This
  // is an external-store write (not React state of this component), so doing it
  // in a `useMemo` keyed on the param is effect-free and runs only when the
  // inbound `ref` actually changes — no `useEffect` needed. The store setter
  // no-ops on a blank value, so navigating here without a `ref` never clears a
  // previously captured code. Only meaningful on a new listing (the param is
  // never present in edit mode), so attribution applies to the property the
  // referral was for.
  const referralParam = Array.isArray(ref) ? ref[0] : ref;
  useMemo(() => {
    if (!propertyId) {
      useReferralStore.getState().setReferralCode(referralParam);
    }
  }, [referralParam, propertyId]);

  const {
    formData,
    stepIndex,
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
    applyAddressSelection,
    handleAddressSelect,
    handleShowFloorToggle,
    handleFloorChange,
    handleAmenityToggle,
    handlePropertyTypeChange,
    handleNextStep,
    handlePrevStep,
  } = usePropertyCreateForm(propertyId);

  // --- Drafts (new listings only) --------------------------------------------
  const draftId = useCreatePropertyFormStore((state) => state.draftId);
  const hasHydrated = useCreatePropertyFormStore((state) => state.hasHydrated);

  // On arrival: resume the draft the drafts screen handed over. Otherwise the
  // form the store restored IS the resumption — everything typed since the last
  // step transition, at the step it was typed on — and the only thing to do is
  // leave it alone. A form still holding a listing opened for EDITING is the
  // one case that must be cleared: "Create" never starts from somebody's home.
  //
  // Gated on `hasHydrated` because the restore is asynchronous: acting on the
  // first render would read the defaults, see no draft, and reset over the very
  // work being restored.
  useEffect(() => {
    if (isEditMode || !hasHydrated) return;
    let cancelled = false;
    takeDraftToResume()
      .then((resumed) => {
        if (cancelled) return;
        const store = useCreatePropertyFormStore.getState();
        if (resumed) {
          store.loadForm(resumed.formData, resumed.id, resumed.step);
        } else if (store.editingPropertyId) {
          store.resetForm();
        }
      })
      .catch((error: unknown) => {
        logger.error('Error resuming property draft', error);
        toast.error(t('property.drafts.toastLoadFailed'));
      });
    return () => {
      cancelled = true;
    };
    // Once per visit to the create screen, after the restore has been attempted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, hasHydrated]);

  const persistDraft = useCallback(async (): Promise<boolean> => {
    const store = useCreatePropertyFormStore.getState();
    const id = store.draftId ?? newDraftId();
    try {
      // The step goes with the form: a draft reopened from `/properties/drafts`
      // returns the host to where they stopped, not to step one.
      await saveDraft(id, store.formData, store.currentStep);
      store.setDraftId(id);
      return true;
    } catch (error: unknown) {
      logger.error('Error saving property draft', error);
      return false;
    }
  }, []);

  const handleSaveDraft = useCallback(async () => {
    if (await persistDraft()) toast.success(t('propertyCreate.draftSaved'));
    else toast.error(t('propertyCreate.draftSaveFailed'));
  }, [persistDraft, t]);

  const { handleSubmit } = useCreatePropertyWizard(propertyId, {
    onCreated: () => {
      const published = useCreatePropertyFormStore.getState().draftId;
      if (!published) return;
      deleteDraft(published).catch((error: unknown) =>
        logger.error('Error deleting published property draft', error),
      );
    },
  });

  // --- Navigation -------------------------------------------------------------
  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  const isLastStep = stepIndex === steps.length - 1;
  const handleNext = useCallback(() => {
    if (isLastStep) {
      handleSubmit();
      return;
    }
    if (!handleNextStep()) return;
    scrollToTop();
    if (!isEditMode) void persistDraft();
  }, [isLastStep, handleSubmit, handleNextStep, scrollToTop, isEditMode, persistDraft]);

  const handleBack = useCallback(() => {
    handlePrevStep();
    scrollToTop();
  }, [handlePrevStep, scrollToTop]);

  const wizardSteps = useMemo<WizardStep[]>(
    () =>
      steps.map((step) => {
        const copy = STEP_COPY[step];
        return {
          key: step,
          title: copy ? t(copy.title) : step,
          description: copy?.description ? t(copy.description) : undefined,
        };
      }),
    [steps, t],
  );
  const formatStepCount = useCallback(
    (current: number, total: number) => t('reviews.write.stepCounter', { current, total }),
    [t],
  );

  const railIsWide = useIsRightBarVisible();
  const routeHasRail = useHasRightBar();
  const railShowsPreview = railIsWide && routeHasRail;

  const [showFullscreenMap, setShowFullscreenMap] = useState(false);

  const openFullscreenMap = useCallback(() => setShowFullscreenMap(true), []);
  const closeFullscreenMap = useCallback(() => setShowFullscreenMap(false), []);

  const handleFullscreenAddressSelect = useCallback(
    (address: GeocodedAddress, coordinates: [number, number]) => {
      applyAddressSelection(address, coordinates);
      setShowFullscreenMap(false);
    },
    [applyAddressSelection],
  );

  const title = isEditMode ? t('propertyCreate.title.edit') : t('propertyCreate.title.create');

  // Show loading state when in edit mode and property is loading
  if (isEditMode && propertyLoading) {
    return (
      <View style={styles.container}>
        <Header options={{ title, showBackButton: true }} />
        <View style={styles.centeredState}>
          <Loading size="large" text={t('propertyCreate.loading')} />
        </View>
      </View>
    );
  }

  // Show error state if property failed to load in edit mode
  if (isEditMode && propertyError) {
    return (
      <View style={styles.container}>
        <Header options={{ title, showBackButton: true }} />
        <View style={styles.centeredState}>
          <Admonition type="error">
            {t('propertyCreate.loadError', { error: propertyError || t('property.notFound') })}
          </Admonition>
          <Button leadingIcon={RiArrowLeftLine} onPress={() => router.back()}>
            {t('common.goBack')}
          </Button>
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
      <Header options={{ title, showBackButton: true }} />

      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <WizardProgress
          steps={wizardSteps}
          current={stepIndex}
          formatStepCount={formatStepCount}
          headingLevel={2}
          action={
            isEditMode ? undefined : (
              <Button
                variant="secondary"
                size="small"
                onPress={() => void handleSaveDraft()}
                testID="create-property-save-draft"
              >
                {t('propertyCreate.saveDraft')}
              </Button>
            )
          }
          testID="create-property-progress"
        />

        <CreatePropertyStepContent
          stepName={stepName}
          formData={formData}
          validationErrors={validationErrors}
          fieldsToShow={fieldsToShow}
          isLoading={isLoading}
          submitError={submitError}
          railShowsPreview={railShowsPreview}
          mapRef={mapRef}
          updateFormField={updateFormField}
          setFormData={setFormData}
          onPropertyTypeChange={handlePropertyTypeChange}
          onAddressSelect={handleAddressSelect}
          onOpenFullscreenMap={openFullscreenMap}
          onFloorChange={handleFloorChange}
          onShowFloorToggle={handleShowFloorToggle}
          onAmenityToggle={handleAmenityToggle}
        />
      </ScrollView>

      <WizardFooter
        onBack={stepIndex > 0 ? handleBack : undefined}
        backLabel={t('common.back')}
        backDisabled={isLoading}
        onNext={handleNext}
        nextLabel={
          isLastStep
            ? isEditMode
              ? t('propertyCreate.saveChanges')
              : t('propertyCreate.publish')
            : t('common.next')
        }
        loading={isLastStep && isLoading}
        status={!isEditMode && draftId ? t('propertyCreate.draftSaved') : undefined}
        // The page's own surface (the shell's card), not Bloom's default background.
        style={theme.isDark ? undefined : { backgroundColor: theme.colors.card }}
        testID="create-property-footer"
      />

      <FullscreenMapModal
        visible={showFullscreenMap}
        mapRef={fullscreenMapRef}
        onClose={closeFullscreenMap}
        onAddressSelect={handleFullscreenAddressSelect}
      />
    </KeyboardAvoidingView>
  );
}
