import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useReferralStore } from '@/store/referralStore';
import { useCreatePropertyFormStore } from '@/store/createPropertyFormStore';
import { Admonition } from '@oxy.so/bloom/admonition';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { Button } from '@oxy.so/bloom/button';
import { RiArrowLeftLine } from '@oxy.so/bloom/icons';
import { Loading } from '@oxy.so/bloom/loading';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { WizardFooter, WizardProgress, type WizardStep } from '@oxy.so/bloom/wizard';
import type { GeocodedAddress } from '@/components/Map';
import { useHasRightBar } from '@/components/RightBar';
import { usePropertyCreateForm } from '@/hooks/usePropertyCreateForm';
import { useCreatePropertyWizard } from '@/hooks/useCreatePropertyWizard';
import { logger } from '@/utils/logger';
import { deleteDraft, newDraftId, saveDraft } from '@/utils/propertyDrafts';
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
 * Frame: `WizardProgress` names the step at the top of the page, and
 * `WizardFooter` (Back / Next, Publish on the last step) is the screen's pinned
 * bottom bar. The live preview and the quality checklist are the right rail's (`PropertyPreviewWidget`); below
 * the rail's breakpoint the Preview step draws them.
 *
 * Drafts: advancing a step saves the form to the named, listable draft
 * (`utils/propertyDrafts`, what `/properties/drafts` shows), as does the "Save
 * draft" action; publishing deletes it. New listings only — an edit is not a
 * draft of anything. Continuing a draft puts it in the form before this screen
 * opens (`openDraft`), and arriving here opens the form session
 * (`usePropertyCreateForm`), so this screen has nothing to load on arrival.
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

  // A partner referral code carried on the create-property link
  // (`…/properties/create?ref=<code>`) is captured into the persisted referral
  // store when the host acts on the flow — advancing a step, saving a draft or
  // publishing — so the submit (which reads the store) attributes the listing,
  // and an interrupted flow finished later still does. The store setter no-ops
  // on a blank value, so acting here without a `ref` never clears a previously
  // captured code. New listings only (the param is never present in edit mode).
  const referralParam = Array.isArray(ref) ? ref[0] : ref;
  const captureReferral = useCallback(() => {
    if (!propertyId) useReferralStore.getState().setReferralCode(referralParam);
  }, [propertyId, referralParam]);

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
    captureReferral();
    if (await persistDraft()) toast.success(t('propertyCreate.draftSaved'));
    else toast.error(t('propertyCreate.draftSaveFailed'));
  }, [captureReferral, persistDraft, t]);

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
  // The screen's scroller: the window on web, the scroll view on native.
  const scrollRef = useRef<ScrollView>(null);
  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  const isLastStep = stepIndex === steps.length - 1;
  const handleNext = useCallback(() => {
    captureReferral();
    if (isLastStep) {
      handleSubmit();
      return;
    }
    if (!handleNextStep()) return;
    scrollToTop();
    if (!isEditMode) void persistDraft();
  }, [
    captureReferral,
    isLastStep,
    handleSubmit,
    handleNextStep,
    scrollToTop,
    isEditMode,
    persistDraft,
  ]);

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

  const routeHasRail = useHasRightBar();

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
  const header = (
    <PageHeader
      title={title}
      titleAlign="center"
      leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
      onBack={router.canGoBack() ? router.back : undefined}
      backLabel={t('goBack')}
    />
  );

  // Show loading state when in edit mode and property is loading
  if (isEditMode && propertyLoading) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView contentContainerStyle={styles.centeredState}>
          <Loading size="lg" text={t('propertyCreate.loading')} />
        </ScreenScrollView>
      </Screen>
    );
  }

  // Show error state if property failed to load in edit mode
  if (isEditMode && propertyError) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView contentContainerStyle={styles.centeredState}>
          <Admonition type="error">
            {t('propertyCreate.loadError', { error: propertyError || t('property.notFound') })}
          </Admonition>
          <Button leadingIcon={RiArrowLeftLine} onPress={() => router.back()}>
            {t('common.goBack')}
          </Button>
        </ScreenScrollView>
      </Screen>
    );
  }

  return (
    <Screen
      documentScroll
      header={header}
      bottomBar={
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
          sticky={false}
          testID="create-property-footer"
        />
      }
    >
      <ScreenScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent}>
        <WizardProgress
          steps={wizardSteps}
          current={stepIndex}
          formatStepCount={formatStepCount}
          headingLevel={2}
          action={
            isEditMode ? undefined : (
              <Button
                size="sm"
                onPress={() => void handleSaveDraft()}
                testID="create-property-save-draft"
                tone="neutral"
                appearance="outline"
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
          routeHasRail={routeHasRail}
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
      </ScreenScrollView>

      <FullscreenMapModal
        visible={showFullscreenMap}
        mapRef={fullscreenMapRef}
        onClose={closeFullscreenMap}
        onAddressSelect={handleFullscreenAddressSelect}
      />
    </Screen>
  );
}
