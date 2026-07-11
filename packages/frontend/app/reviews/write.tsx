/**
 * Write review — the 8-step review wizard route + state owner.
 *
 * This screen owns the single `ReviewWizardData` object, the step index, the
 * `?addressId=` prefill (seeds the address step from an existing Homiio
 * address), and the submit → `CreateReviewPayload`. Each step is a component
 * under `components/reviews/write/`; `WizardProgress` is the bottom nav.
 *
 * Hard-required steps gate `Next`/`Submit` (address, price + dates, title +
 * opinion, rating + recommendation); every dimension step is skippable. On
 * submit the review is created and we `router.replace` to the reviewed
 * address's page on its reviews tab. `livedForMonths` is NOT sent — the server
 * derives it from the dates.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import * as Skeleton from '@oxyhq/bloom/skeleton';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { useOxy } from '@oxyhq/services';

import { Header } from '@/components/Header';
import type { MapApi, AddressData } from '@/components/Map';
import { ErrorState } from '@/components/ui/ErrorState';
import { WizardProgress } from '@/components/reviews/WizardProgress';
import { StepAddress } from '@/components/reviews/write/StepAddress';
import { StepApartment } from '@/components/reviews/write/StepApartment';
import { StepManagement } from '@/components/reviews/write/StepManagement';
import { StepBuilding } from '@/components/reviews/write/StepBuilding';
import { StepArea } from '@/components/reviews/write/StepArea';
import { StepPriceDates } from '@/components/reviews/write/StepPriceDates';
import { StepTexts } from '@/components/reviews/write/StepTexts';
import { StepPhotosRecommend } from '@/components/reviews/write/StepPhotosRecommend';
import {
  INITIAL_WIZARD_DATA,
  type ReviewWizardData,
} from '@/components/reviews/write/types';
import { reviewService } from '@/services/reviewService';
import { api } from '@/utils/api';
import type { CreateReviewPayload, CreateReviewAddressInput } from '@homiio/shared-types';
import { radius, spacing } from '@/constants/styles';
import { colors } from '@/styles/colors';

const TOTAL_STEPS = 8;
const LAST_STEP = TOTAL_STEPS - 1;
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

export default function WriteReviewPage() {
  const { addressId } = useLocalSearchParams<{ addressId?: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { oxyServices, activeSessionId } = useOxy();
  const mapRef = useRef<MapApi | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  const [data, setData] = useState<ReviewWizardData>(INITIAL_WIZARD_DATA);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const update = useCallback(
    <K extends keyof ReviewWizardData>(field: K, value: ReviewWizardData[K]) => {
      setData((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  // Prefill the address step when arriving from an existing Homiio address.
  useEffect(() => {
    if (!addressId || !oxyServices || !activeSessionId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const response = await api.get(`/api/addresses/${addressId}`);
        if (cancelled) return;
        const address = response.data?.address || response.data;
        setData((prev) => ({
          ...prev,
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
        }));
        if (address.coordinates?.coordinates && mapRef.current) {
          const [lng, lat] = address.coordinates.coordinates;
          mapRef.current.navigateToLocation([lng, lat], 15);
        }
      } catch {
        if (!cancelled) setLoadError(t('reviews.write.loadAddressFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [addressId, oxyServices, activeSessionId, t]);

  const handleAddressSelect = useCallback(
    (address: AddressData, coordinates: [number, number]) => {
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
          data.street.trim() &&
            data.city.trim() &&
            data.postal_code.trim() &&
            data.country.trim(),
        );
      case 5:
        return Boolean(
          Number(data.price) > 0 && data.livedFrom.trim() && data.livedTo.trim(),
        );
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

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const goNext = useCallback(() => {
    if (!canProceed) return;
    setStep((prev) => Math.min(prev + 1, LAST_STEP));
    scrollToTop();
  }, [canProceed, scrollToTop]);

  const goBack = useCallback(() => {
    setStep((prev) => Math.max(prev - 1, 0));
    scrollToTop();
  }, [scrollToTop]);

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
      price: Number(data.price),
      currency: data.currency,
      livedFrom: new Date(data.livedFrom),
      livedTo: new Date(data.livedTo),
      prosItems: data.prosItems,
      consItems: data.consItems,
      // Store the display URL (reviews have no server-side image pipeline), so
      // the card can render the photo directly via `resolveBackendImageUrl`.
      images: data.images.map((image) => image.urls.medium || image.urls.original),
      agencyName: data.agencyName.trim() || undefined,
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
    Boolean(data.street.trim() && data.city.trim() && data.postal_code.trim() && data.country.trim()) &&
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
      case 7:
      default:
        return <StepPhotosRecommend data={data} update={update} />;
    }
  };

  if (loading) {
    return (
      <View style={styles.root}>
        <Header options={{ title: t('reviews.write.title'), showBackButton: true }} />
        <ScrollView>
          <WriteReviewSkeleton />
        </ScrollView>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.root}>
        <Header options={{ title: t('reviews.write.title'), showBackButton: true }} />
        <ErrorState
          icon="cloud-offline-outline"
          title={t('reviews.write.loadAddressFailed')}
          description={loadError}
          retryLabel={t('common.goBack')}
          onRetry={() => router.back()}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Header options={{ title: t('reviews.write.title'), showBackButton: true }} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {renderStep()}
          {submitError ? (
            <BloomText style={styles.submitError}>{submitError}</BloomText>
          ) : null}
        </ScrollView>
        <WizardProgress
          step={step}
          totalSteps={TOTAL_STEPS}
          onBack={goBack}
          onNext={goNext}
          onSubmit={handleSubmit}
          isFirst={step === 0}
          isLast={step === LAST_STEP}
          nextDisabled={!canProceed}
          submitting={submitting}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  skeletonBlock: {
    gap: spacing.md,
  },
  submitError: {
    fontSize: 14,
    color: colors.error,
    textAlign: 'center',
  },
});
