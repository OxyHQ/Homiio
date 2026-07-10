/**
 * Write review — full review form (address + tenancy + ratings + opinion).
 *
 * Stream Q polish:
 *   - Bloom TextField for every input (no raw TextInput / inline styles).
 *   - Bloom Button for submit + recommendation choice + retry.
 *   - withShadow('sm') section cards with radius.lg.
 *   - Bloom Skeleton + shared EmptyState / ErrorState while loading.
 *   - Stars now use Bloom Typography for the count label, semantic
 *     ratingStar token instead of hex literals.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { TextFieldInput } from '@oxyhq/bloom/text-field';
import { H2, H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { useOxy } from '@oxyhq/services';
import { Header } from '@/components/Header';
import Map, { type MapApi } from '@/components/Map';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import reviewService from '@/services/reviewService';
import { api } from '@/utils/api';
import { radius, spacing, withShadow } from '@/constants/styles';
import { colors } from '@/styles/colors';

interface ReviewFormData {
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  number?: string;
  building_name?: string;
  floor?: string;
  unit?: string;
  latitude?: number;
  longitude?: number;
  greenHouse: string;
  price: string;
  currency: string;
  livedFrom: string;
  livedTo: string;
  recommendation: boolean | null;
  opinion: string;
  positiveComment: string;
  negativeComment: string;
  rating: number;
}

const INITIAL_FORM: ReviewFormData = {
  street: '',
  city: '',
  state: '',
  postal_code: '',
  country: '',
  number: '',
  building_name: '',
  floor: '',
  unit: '',
  latitude: undefined,
  longitude: undefined,
  greenHouse: '',
  price: '',
  currency: 'EUR',
  livedFrom: '',
  livedTo: '',
  recommendation: null,
  opinion: '',
  positiveComment: '',
  negativeComment: '',
  rating: 0,
};

interface AddressLookupResult {
  street?: string;
  houseNumber?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
}

const WriteReviewSkeleton: React.FC = () => (
  <View style={styles.content}>
    {Array.from({ length: 3 }).map((_, idx) => (
      <View key={idx} style={styles.sectionCard}>
        <Skeleton.Text style={{ width: 200, lineHeight: 20 }} />
        <Skeleton.Box width="100%" height={48} borderRadius={radius.md} />
        <Skeleton.Box width="100%" height={48} borderRadius={radius.md} />
        <Skeleton.Box width="100%" height={48} borderRadius={radius.md} />
      </View>
    ))}
  </View>
);

export default function WriteReviewPage() {
  const { addressId } = useLocalSearchParams<{ addressId: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { oxyServices, activeSessionId } = useOxy();
  const mapRef = useRef<MapApi | null>(null);

  const [formData, setFormData] = useState<ReviewFormData>(INITIAL_FORM);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!addressId || !oxyServices || !activeSessionId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const response = await api.get(`/api/addresses/${addressId}`);
        if (cancelled) return;
        const address = response.data?.address || response.data;
        setFormData((prev) => ({
          ...prev,
          street: address.street || '',
          // Geo is relational: the address exposes resolved display NAMES; seed
          // the form's resolution inputs from them (fall back to legacy strings).
          city: address.cityName || address.city || '',
          state: address.regionName || address.state || '',
          postal_code: address.postal_code || address.zipCode || '',
          country: address.countryName || address.country || '',
          number: address.number || '',
          building_name: address.building_name || '',
          floor: address.floor || '',
          unit: address.unit || '',
          latitude: address.coordinates?.coordinates?.[1],
          longitude: address.coordinates?.coordinates?.[0],
        }));
        if (address.coordinates?.coordinates && mapRef.current) {
          const [lng, lat] = address.coordinates.coordinates;
          mapRef.current.navigateToLocation([lng, lat], 15);
        }
      } catch {
        if (!cancelled) setError(t('reviews.write.loadAddressFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [addressId, oxyServices, activeSessionId, t]);

  const handleAddressSelect = useCallback(
    (address: AddressLookupResult, coordinates: [number, number]) => {
      setFormData((prev) => ({
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
      if (mapRef.current) {
        mapRef.current.navigateToLocation(coordinates, 15);
      }
    },
    [],
  );

  const updateFormData = <K extends keyof ReviewFormData>(
    field: K,
    value: ReviewFormData[K],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const validateForm = (): boolean => {
    if (!formData.street.trim()) {
      Alert.alert(t('reviews.write.validationTitle'), t('reviews.write.streetRequired'));
      return false;
    }
    if (!formData.city.trim()) {
      Alert.alert(t('reviews.write.validationTitle'), t('reviews.write.cityRequired'));
      return false;
    }
    if (!formData.postal_code.trim()) {
      Alert.alert(t('reviews.write.validationTitle'), t('reviews.write.postalCodeRequired'));
      return false;
    }
    if (!formData.country.trim()) {
      Alert.alert(t('reviews.write.validationTitle'), t('reviews.write.countryRequired'));
      return false;
    }
    if (!formData.opinion.trim()) {
      Alert.alert(
        t('reviews.write.validationTitle'),
        t('reviews.write.opinionRequired'),
      );
      return false;
    }
    if (formData.opinion.trim().length < 10) {
      Alert.alert(
        t('reviews.write.validationTitle'),
        t('reviews.write.opinionMinLength'),
      );
      return false;
    }
    if (!formData.price || parseFloat(formData.price) <= 0) {
      Alert.alert(t('reviews.write.validationTitle'), t('reviews.write.priceRequired'));
      return false;
    }
    if (!formData.livedFrom || !formData.livedTo) {
      Alert.alert(
        t('reviews.write.validationTitle'),
        t('reviews.write.datesRequired'),
      );
      return false;
    }
    if (formData.recommendation === null) {
      Alert.alert(
        t('reviews.write.validationTitle'),
        t('reviews.write.recommendationRequired'),
      );
      return false;
    }
    if (formData.rating === 0) {
      Alert.alert(
        t('reviews.write.validationTitle'),
        t('reviews.write.ratingRequired'),
      );
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    if (!oxyServices || !activeSessionId) return;

    setSubmitting(true);
    try {
      const startDate = new Date(formData.livedFrom);
      const endDate = new Date(formData.livedTo);
      const diffMs = Math.abs(endDate.getTime() - startDate.getTime());
      const livedForMonths = Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 30.44));

      const reviewData = {
        address: {
          street: formData.street.trim(),
          city: formData.city.trim(),
          state: formData.state.trim() || undefined,
          postal_code: formData.postal_code.trim(),
          country: formData.country.trim(),
          number: formData.number?.trim() || undefined,
          building_name: formData.building_name?.trim() || undefined,
          floor: formData.floor?.trim() || undefined,
          unit: formData.unit?.trim() || undefined,
          ...(formData.latitude !== undefined && formData.longitude !== undefined
            ? { latitude: formData.latitude, longitude: formData.longitude }
            : null),
        },
        greenHouse: formData.greenHouse,
        price: formData.price ? parseFloat(formData.price) : undefined,
        currency: formData.currency,
        livedFrom: formData.livedFrom ? new Date(formData.livedFrom) : undefined,
        livedTo: formData.livedTo ? new Date(formData.livedTo) : undefined,
        livedForMonths,
        recommendation: formData.recommendation as boolean,
        opinion: formData.opinion.trim(),
        positiveComment: formData.positiveComment.trim() || undefined,
        negativeComment: formData.negativeComment.trim() || undefined,
        rating: formData.rating,
      };

      const result = await reviewService.createReview(
        reviewData,
        oxyServices,
        activeSessionId,
      );
      if (result.success) {
        Alert.alert(t('common.success'), t('reviews.write.submitSuccess'), [
          { text: t('common.ok'), onPress: () => router.back() },
        ]);
      } else {
        Alert.alert(
          t('common.error'),
          result.error || t('reviews.write.submitFailed'),
        );
      }
    } catch {
      Alert.alert(t('common.error'), t('reviews.write.submitFailedRetry'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.root}>
        <Header
          options={{ title: t('reviews.write.title'), showBackButton: true }}
        />
        <ScrollView>
          <WriteReviewSkeleton />
        </ScrollView>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.root}>
        <Header
          options={{ title: t('reviews.write.title'), showBackButton: true }}
        />
        <ErrorState
          icon="cloud-offline-outline"
          title={t('reviews.write.loadAddressFailed')}
          description={error}
          retryLabel={t('common.goBack')}
          onRetry={() => router.back()}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Header
        options={{ title: t('reviews.write.title'), showBackButton: true }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.titleBlock}>
            <SectionEyebrow>Tell others</SectionEyebrow>
            <H2 style={styles.title}>Review this address</H2>
            <BloomText style={styles.subtitle}>
              Honest, anonymous reviews help future tenants choose with
              confidence.
            </BloomText>
          </View>

          <View style={styles.sectionCard}>
            <H3 style={styles.sectionTitle}>Address</H3>
            <TextFieldInput
              label="Street address"
              placeholder="e.g. 123 Main Street"
              value={formData.street}
              onChangeText={(text) => updateFormData('street', text)}
            />
            <TextFieldInput
              label="Building number"
              placeholder="e.g. 123A"
              value={formData.number || ''}
              onChangeText={(text) => updateFormData('number', text)}
            />
            <TextFieldInput
              label="Building name"
              placeholder="e.g. Sunset Apartments"
              value={formData.building_name || ''}
              onChangeText={(text) => updateFormData('building_name', text)}
            />
            <View style={styles.row}>
              <View style={styles.rowField}>
                <TextFieldInput
                  label="Floor"
                  placeholder="e.g. 3"
                  value={formData.floor || ''}
                  onChangeText={(text) => updateFormData('floor', text)}
                />
              </View>
              <View style={styles.rowField}>
                <TextFieldInput
                  label="Unit / Apt"
                  placeholder="e.g. 3B"
                  value={formData.unit || ''}
                  onChangeText={(text) => updateFormData('unit', text)}
                />
              </View>
            </View>
            <View style={styles.row}>
              <View style={styles.rowField}>
                <TextFieldInput
                  label="City"
                  placeholder="e.g. Barcelona"
                  value={formData.city}
                  onChangeText={(text) => updateFormData('city', text)}
                />
              </View>
              <View style={styles.rowField}>
                <TextFieldInput
                  label="State / Province"
                  placeholder="e.g. Catalonia"
                  value={formData.state}
                  onChangeText={(text) => updateFormData('state', text)}
                />
              </View>
            </View>
            <View style={styles.row}>
              <View style={styles.rowField}>
                <TextFieldInput
                  label="Postal code"
                  placeholder="e.g. 08001"
                  value={formData.postal_code}
                  onChangeText={(text) => updateFormData('postal_code', text)}
                />
              </View>
              <View style={styles.rowField}>
                <TextFieldInput
                  label="Country"
                  placeholder="e.g. Spain"
                  value={formData.country}
                  onChangeText={(text) => updateFormData('country', text)}
                />
              </View>
            </View>

            <View style={styles.mapWrapper}>
              <Map
                ref={mapRef}
                style={styles.mapInner}
                enableAddressLookup
                showAddressInstructions
                onAddressSelect={handleAddressSelect}
                screenId="write-review"
              />
            </View>
            <BloomText style={styles.mapHint}>
              Tap on the map to drop a pin and auto-fill the address.
            </BloomText>
          </View>

          <View style={styles.sectionCard}>
            <H3 style={styles.sectionTitle}>Basics</H3>
            <TextFieldInput
              label="Monthly rent (€)"
              placeholder="0.00"
              value={formData.price}
              onChangeText={(text) => updateFormData('price', text)}
              keyboardType="numeric"
            />
            <TextFieldInput
              label="Apartment description"
              placeholder="e.g. 2nd floor, garden view"
              value={formData.greenHouse}
              onChangeText={(text) => updateFormData('greenHouse', text)}
              multiline
            />
            <View style={styles.row}>
              <View style={styles.rowField}>
                <TextFieldInput
                  label="Lived from"
                  placeholder="YYYY-MM-DD"
                  value={formData.livedFrom}
                  onChangeText={(text) => updateFormData('livedFrom', text)}
                />
              </View>
              <View style={styles.rowField}>
                <TextFieldInput
                  label="Lived to"
                  placeholder="YYYY-MM-DD"
                  value={formData.livedTo}
                  onChangeText={(text) => updateFormData('livedTo', text)}
                />
              </View>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <H3 style={styles.sectionTitle}>Your verdict</H3>
            <View style={styles.starsBlock}>
              <BloomText style={styles.fieldLabel}>Overall rating</BloomText>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((star) => {
                  const active = star <= formData.rating;
                  return (
                    <Pressable
                      key={star}
                      onPress={() => updateFormData('rating', star)}
                      style={styles.starButton}
                      accessibilityRole="button"
                      accessibilityLabel={`Rate ${star} of 5`}
                    >
                      <Ionicons
                        name={active ? 'star' : 'star-outline'}
                        size={30}
                        color={active ? colors.ratingStar : colors.muted}
                      />
                    </Pressable>
                  );
                })}
              </View>
              <BloomText style={styles.ratingLabel}>
                {formData.rating > 0
                  ? `${formData.rating} of 5`
                  : 'No rating yet'}
              </BloomText>
            </View>

            <View style={styles.recommendBlock}>
              <BloomText style={styles.fieldLabel}>
                Would you recommend this address?
              </BloomText>
              <View style={styles.recommendRow}>
                <Button
                  variant={formData.recommendation === true ? 'primary' : 'secondary'}
                  size="medium"
                  onPress={() => updateFormData('recommendation', true)}
                  icon={
                    <Ionicons
                      name="thumbs-up"
                      size={18}
                      color={
                        formData.recommendation === true
                          ? colors.primaryForeground
                          : colors.COLOR_BLACK
                      }
                    />
                  }
                  style={styles.recommendButton}
                >
                  Yes
                </Button>
                <Button
                  variant={formData.recommendation === false ? 'primary' : 'secondary'}
                  size="medium"
                  onPress={() => updateFormData('recommendation', false)}
                  icon={
                    <Ionicons
                      name="thumbs-down"
                      size={18}
                      color={
                        formData.recommendation === false
                          ? colors.primaryForeground
                          : colors.COLOR_BLACK
                      }
                    />
                  }
                  style={styles.recommendButton}
                >
                  No
                </Button>
              </View>
            </View>

            <TextFieldInput
              label="Your opinion"
              placeholder="Share your experience (10+ characters)"
              value={formData.opinion}
              onChangeText={(text) => updateFormData('opinion', text)}
              multiline
            />
            <TextFieldInput
              label="What did you like?"
              placeholder="Positive aspects of living here"
              value={formData.positiveComment}
              onChangeText={(text) => updateFormData('positiveComment', text)}
              multiline
            />
            <TextFieldInput
              label="What could be improved?"
              placeholder="Areas for improvement"
              value={formData.negativeComment}
              onChangeText={(text) => updateFormData('negativeComment', text)}
              multiline
            />
          </View>

          <View style={styles.noteCard}>
            <Ionicons
              name="information-circle"
              size={20}
              color={colors.info}
            />
            <BloomText style={styles.noteText}>
              Additional detailed ratings for the apartment, community, and
              area are optional and can be added later.
            </BloomText>
          </View>

          <Button
            variant="primary"
            size="large"
            onPress={handleSubmit}
            loading={submitting}
            disabled={submitting}
            style={styles.submitButton}
          >
            Submit review
          </Button>
        </ScrollView>
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
  titleBlock: {
    gap: spacing.xs,
  },
  title: {
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
  },
  sectionCard: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.md,
    ...withShadow('sm'),
  },
  sectionTitle: {
    letterSpacing: -0.3,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowField: {
    flex: 1,
  },
  mapWrapper: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.mutedSubtle,
  },
  mapInner: {
    height: 280,
  },
  mapHint: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
  },
  starsBlock: {
    gap: spacing.sm,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  starsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  starButton: {
    padding: spacing.xs,
  },
  ratingLabel: {
    fontSize: 13,
    color: colors.muted,
  },
  recommendBlock: {
    gap: spacing.sm,
  },
  recommendRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  recommendButton: {
    flex: 1,
  },
  noteCard: {
    backgroundColor: colors.infoSubtle,
    padding: spacing.md,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  noteText: {
    flex: 1,
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_2,
    lineHeight: 20,
  },
  submitButton: {
    alignSelf: 'stretch',
  },
});
