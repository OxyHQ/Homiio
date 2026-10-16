/**
 * Write review — the 8-step review wizard route + state owner.
 *
 * This screen owns the single `ReviewWizardData` object, the step index, the
 * `?addressId=` prefill (seeds the address step from an existing Homiio
 * address), and the submit → `CreateReviewPayload`. Each step is a component
 * under `components/reviews/write/`. Bloom's `wizard` draws the frame: the
 * `WizardProgress` bar names the step at the top of the page, and the
 * `WizardFooter` under it is Back / Next (Submit on the last step).
 *
 * Hard-required steps gate `Next`/`Submit` (address, price + dates, title +
 * opinion, rating + recommendation); every dimension step is skippable. On
 * submit the review is created and we `router.replace` to the reviewed
 * address's page on its reviews tab. `livedForMonths` is NOT sent — the server
 * derives it from the dates.
 */
import type React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { Admonition } from '@oxy.so/bloom/admonition';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { PageHeader } from '@oxy.so/bloom/page-header';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { WizardFooter, WizardProgress, type WizardStep } from '@oxy.so/bloom/wizard';
import { useOxy } from '@oxy.so/services';

import type { MapApi, GeocodedAddress } from '@/components/Map';
import { ErrorState } from '@/components/ui/ErrorState';
import { StepAddress } from '@/components/reviews/write/StepAddress';
import { StepApartment } from '@/components/reviews/write/StepApartment';
import { StepManagement } from '@/components/reviews/write/StepManagement';
import { StepBuilding } from '@/components/reviews/write/StepBuilding';
import { StepArea } from '@/components/reviews/write/StepArea';
import { StepPriceDates } from '@/components/reviews/write/StepPriceDates';
import { StepTexts } from '@/components/reviews/write/StepTexts';
import { StepPhotosRecommend } from '@/components/reviews/write/StepPhotosRecommend';
import { INITIAL_WIZARD_DATA, type ReviewWizardData } from '@/components/reviews/write/types';
import { reviewService } from '@/services/reviewService';
import { api } from '@/utils/api';
import type { CreateReviewPayload, CreateReviewAddressInput } from '@homiio/shared-types';
import { radius, spacing } from '@/constants/styles';
import { RiAlertLine } from '@oxy.so/bloom/icons';

/** The steps, in order: each one's copy lives at `reviews.write.steps.<key>`. */
const STEP_KEYS = [
  'address',
  'apartment',
  'management',
  'building',
  'area',
  'priceDates',
  'texts',
  'photos',
] as const;
const LAST_STEP = STEP_KEYS.length - 1;
const MIN_TITLE_LENGTH = 5;
const MIN_OPINION_LENGTH = 10;

const WriteReviewSkeleton: React.FC = () => (
  <View style={styles.content}>
    {Array.from({ length: 3 }).map((_, idx) => (
      <View key={idx} style={styles.skeletonBlock}>
        <Skeleton.Text style={{ width: 200, lineHeight: 20 }} />
        <Skeleton.Box width="100%" height={48} borderRadius={radius.md} />
        <Skeleton.Box width="100%" height={48} borderRadius={radius.md} />
      </View>
    ))}
  </View>
);

/** The fields of `GET /api/addresses/:id` the prefill reads. */
interface AddressPayload {
  street?: string;
  cityName?: string;
  city?: string;
  regionName?: string;
  state?: string;
  postal_code?: string;
  zipCode?: string;
  countryName?: string;
  country?: string;
  number?: string;
  building_name?: string;
  floor?: string;
  unit?: string;
  neighborhoodName?: string;
  neighborhood?: string;
  coordinates?: { coordinates?: [number, number] };
}

/**
 * The address step's fields, prefilled from an existing Homiio address.
 *
 * `floor` and `unit` arrive only when the endpoint serves them — the person
 * owns a listing at that address, or holds an active lease there (ADR 0003
 * §3.2; `db/addresses/addressAudience.ts`). For everybody else they are ABSENT
 * by design and the two steps start empty, which is correct: the author names
 * the flat THEY lived in, and nobody else's door should be typed into their
 * review for them.
 */
function prefillFromAddress(address: AddressPayload): ReviewWizardData {
  return {
    ...INITIAL_WIZARD_DATA,
    street: address.street || '',
    city: address.cityName || address.city || '',
    state: address.regionName || address.state || '',
    postal_code: address.postal_code || address.zipCode || '',
    country: address.countryName || address.country || '',
    number: address.number || '',
    building_name: address.building_name || '',
    floor: address.floor || '',
    unit: address.unit || '',
    neighborhood: address.neighborhoodName || address.neighborhood || '',
    latitude: address.coordinates?.coordinates?.[1],
    longitude: address.coordinates?.coordinates?.[0],
  };
}

function WriteReviewHeader() {
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <PageHeader
      title={t('reviews.write.title')}
      titleAlign="center"
      leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
      onBack={router.canGoBack() ? router.back : undefined}
      backLabel={t('goBack')}
    />
  );
}

export default function WriteReviewPage() {
  const { addressId } = useLocalSearchParams<{ addressId?: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { oxyServices, activeSessionId } = useOxy();

  // Prefill the address step when arriving from an existing Homiio address.
  // Keyed on the session too: what the endpoint serves depends on who asks.
  const addressQuery = useQuery({
    queryKey: ['address', addressId, 'reviewPrefill', activeSessionId],
    queryFn: async () => {
      const response = await api.get<{ address?: AddressPayload } & AddressPayload>(
        `/api/addresses/${addressId}`,
      );
      return prefillFromAddress(response.data?.address || response.data);
    },
    enabled: Boolean(addressId && oxyServices && activeSessionId),
  });

  if (addressQuery.isLoading) {
    return (
      <>
        <WriteReviewHeader />
        <WriteReviewSkeleton />
      </>
    );
  }

  if (addressQuery.isError) {
    return (
      <>
        <WriteReviewHeader />
        <ErrorState
          icon={RiAlertLine}
          title={t('reviews.write.loadAddressFailed')}
          description={t('reviews.write.loadAddressFailed')}
          retryLabel={t('common.goBack')}
          onRetry={() => router.back()}
        />
      </>
    );
  }

  // Keyed so a different prefill starts a fresh wizard rather than editing
  // over the previous one.
  return (
    <WriteReviewWizard
      key={addressQuery.data ? `address:${addressId}` : 'blank'}
      initialData={addressQuery.data ?? INITIAL_WIZARD_DATA}
    />
  );
}

function WriteReviewWizard({ initialData }: { initialData: ReviewWizardData }) {
  const router = useRouter();
  const { t } = useTranslation();
  const mapRef = useRef<MapApi | null>(null);

  const [data, setData] = useState<ReviewWizardData>(initialData);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const wizardSteps = useMemo<WizardStep[]>(
    () =>
      STEP_KEYS.map((key) => ({
        key,
        title: t(`reviews.write.steps.${key}.title`),
        description: t(`reviews.write.steps.${key}.subtitle`),
      })),
    [t],
  );
  const formatStepCount = useCallback(
    (current: number, total: number) => t('reviews.write.stepCounter', { current, total }),
    [t],
  );

  const update = useCallback(
    <K extends keyof ReviewWizardData>(field: K, value: ReviewWizardData[K]) => {
      setData((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleAddressSelect = useCallback(
    (address: GeocodedAddress, coordinates: [number, number]) => {
      setData((prev) => ({
        ...prev,
        latitude: coordinates[1],
        longitude: coordinates[0],
        ...(address.street ? { street: address.street } : null),
        ...(address.houseNumber ? { number: address.houseNumber } : null),
        ...(address.city ? { city: address.city } : null),
        ...(address.state ? { state: address.state } : null),
        ...(address.country ? { country: address.country } : null),
        ...(address.postalCode ? { postal_code: address.postalCode } : null),
      }));
      mapRef.current?.navigateToLocation(coordinates, 15);
    },
    [],
  );

  const canProceed = useMemo(() => {
    switch (step) {
      case 0:
        return Boolean(
          data.street.trim() && data.city.trim() && data.postal_code.trim() && data.country.trim(),
        );
      case 5:
        return Boolean(Number(data.price) > 0 && data.livedFrom.trim() && data.livedTo.trim());
      case 6:
        return (
          data.title.trim().length >= MIN_TITLE_LENGTH &&
          data.opinion.trim().length >= MIN_OPINION_LENGTH
        );
      case 7:
        return data.rating > 0 && data.recommendation !== null;
      default:
        return true;
    }
  }, [step, data]);

  const goNext = useCallback(() => {
    if (!canProceed) return;
    setStep((prev) => Math.min(prev + 1, LAST_STEP));
  }, [canProceed]);

  const goBack = useCallback(() => {
    setStep((prev) => Math.max(prev - 1, 0));
  }, []);

  const buildPayload = useCallback((): CreateReviewPayload => {
    const address: CreateReviewAddressInput = {
      street: data.street.trim(),
      number: data.number.trim() || undefined,
      building_name: data.building_name.trim() || undefined,
      floor: data.floor.trim() || undefined,
      unit: data.unit.trim() || undefined,
      postal_code: data.postal_code.trim(),
      city: data.city.trim(),
      state: data.state.trim() || undefined,
      country: data.country.trim(),
      neighborhood: data.neighborhood.trim() || undefined,
      ...(data.latitude !== undefined && data.longitude !== undefined
        ? { latitude: data.latitude, longitude: data.longitude }
        : null),
    };
    return {
      address,
      title: data.title.trim(),
      opinion: data.opinion.trim(),
      rating: data.rating,
      recommendation: data.recommendation === true,
      // The author's own publication choice (ADR 0003 §5.2).
      authorIdentity: data.authorIdentity,
      price: Number(data.price),
      currency: data.currency,
      livedFrom: new Date(data.livedFrom),
      livedTo: new Date(data.livedTo),
      prosItems: data.prosItems,
      consItems: data.consItems,
      // Store the display URL (reviews have no server-side image pipeline), so
      // the card can render the photo directly via `resolveBackendImageUrl`.
      images: data.images.map((image) => image.urls.medium || image.urls.original),
      agencyOxyAccountId: data.agencyOxyAccountId || undefined,
      adviceToAgency: data.adviceToAgency.trim() || undefined,
      adviceToLandlord: data.adviceToLandlord.trim() || undefined,
      summerTemperature: data.summerTemperature,
      winterTemperature: data.winterTemperature,
      noise: data.noise,
      light: data.light,
      conditionAndMaintenance: data.conditionAndMaintenance,
      landlordTreatment: data.landlordTreatment,
      problemResponse: data.problemResponse,
      depositReturned: data.depositReturned,
      staircaseNeighbors: data.staircaseNeighbors,
      touristApartments: data.touristApartments,
      neighborRelations: data.neighborRelations,
      cleaning: data.cleaning,
      services: data.services.length > 0 ? data.services : undefined,
      areaTourists: data.areaTourists,
      areaNoise: data.areaNoise,
      areaCleanliness: data.areaCleanliness,
      areaSecurity: data.areaSecurity,
    };
  }, [data]);

  const isComplete =
    (!data.agencyName.trim() || Boolean(data.agencyOxyAccountId)) &&
    Boolean(
      data.street.trim() && data.city.trim() && data.postal_code.trim() && data.country.trim(),
    ) &&
    Number(data.price) > 0 &&
    Boolean(data.livedFrom.trim() && data.livedTo.trim()) &&
    data.title.trim().length >= MIN_TITLE_LENGTH &&
    data.opinion.trim().length >= MIN_OPINION_LENGTH &&
    data.rating > 0 &&
    data.recommendation !== null;

  const handleSubmit = useCallback(async () => {
    if (!isComplete || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const review = await reviewService.createReview(buildPayload());
      router.replace(`/addresses/${review.addressId}?tab=reviews`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t('reviews.write.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [isComplete, submitting, buildPayload, router, t]);

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <StepAddress
            data={data}
            update={update}
            mapRef={mapRef}
            onAddressSelect={handleAddressSelect}
          />
        );
      case 1:
        return <StepApartment data={data} update={update} />;
      case 2:
        return <StepManagement data={data} update={update} />;
      case 3:
        return <StepBuilding data={data} update={update} />;
      case 4:
        return <StepArea data={data} update={update} />;
      case 5:
        return <StepPriceDates data={data} update={update} />;
      case 6:
        return <StepTexts data={data} update={update} />;
      default:
        return <StepPhotosRecommend data={data} update={update} />;
    }
  };

  return (
    <>
      <WriteReviewHeader />
      <View style={styles.content}>
        <WizardProgress
          steps={wizardSteps}
          current={step}
          currentProgress={canProceed ? 1 : 0.5}
          formatStepCount={formatStepCount}
          headingLevel={2}
          testID="review-wizard-progress"
        />
        {renderStep()}
        {submitError ? <Admonition type="error">{submitError}</Admonition> : null}
      </View>
      <WizardFooter
        onBack={step > 0 ? goBack : undefined}
        backLabel={t('common.back')}
        backDisabled={submitting}
        onNext={step === LAST_STEP ? handleSubmit : goNext}
        nextLabel={step === LAST_STEP ? t('reviews.write.submit') : t('common.next')}
        nextDisabled={!canProceed}
        loading={step === LAST_STEP && submitting}
        testID="review-wizard-footer"
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  skeletonBlock: {
    gap: spacing.md,
  },
});
