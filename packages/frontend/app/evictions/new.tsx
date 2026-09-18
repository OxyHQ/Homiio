/**
 * Publish / edit an eviction case (publicar).
 *
 * Sectioned form (mirrors `app/reviews/write.tsx`): 1) Qué pasa (title +
 * description) · 2) Dónde (map address lookup → editable label + city + an
 * household-authorisation Switch; the published pin is always a disc) · 3) Cuándo (date
 * + time) · 4) Cómo ayudar (phone/email/telegram/whatsapp + instructions) ·
 * 5) Agencia/fondo ejecutor (free text) · 6) Foto opcional (single upload to the
 * `evictions` folder). Submits through `useCreateEviction` / `useUpdateEviction`
 * then `router.replace`s to the case. Edit mode prefills from the loaded case;
 * the form initialises its state from that snapshot (no prefill `useEffect`).
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { getLocales } from 'expo-localization';
import { Button } from '@oxy.so/bloom/button';
import { Card, CardTitle } from '@oxy.so/bloom/card';
import { DatePicker, TimeField } from '@oxy.so/bloom/date-picker';
import { Field } from '@oxy.so/bloom/field';
import { RiAlertLine, RiImageAddLine } from '@oxy.so/bloom/icons';
import { PhoneInput } from '@oxy.so/bloom/phone-input';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { Switch } from '@oxy.so/bloom/switch';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Textarea } from '@oxy.so/bloom/textarea';
import { H2, Text as BloomText } from '@oxy.so/bloom/typography';

import { CreateEvictionCaseData, EvictionCase } from '@homiio/shared-types';
import { Header } from '@/components/Header';
import Map, { type MapApi, type GeocodedAddress, type LonLat } from '@/components/Map';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import {
  useCreateEviction,
  useEvictionDetail,
  useUpdateEviction,
} from '@/hooks/useEvictionQueries';
import { combineDateAndTime, splitDateAndTime } from '@/components/evictions/evictionUtils';
import {
  type EvictionPhoneValue,
  countryCodeFromPlace,
  emptyEvictionPhone,
  joinEvictionPhone,
  resolveDefaultPhoneCountry,
  splitEvictionPhone,
  withPhoneCountry,
  withPhoneNumber,
} from '@/components/evictions/evictionPhone';
import { imageUploadService } from '@/services/imageUploadService';
import { resolveBackendImageUrl } from '@/utils/imageUrl';
import { toast } from '@oxy.so/bloom/toast';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

interface EvictionFormState {
  title: string;
  description: string;
  label: string;
  city: string;
  /** The picked day (local midnight), from Bloom's `DatePicker`. */
  date: Date | null;
  time: string;
  /** Phone numbers are edited as ISO country + national number. */
  phone: EvictionPhoneValue;
  email: string;
  telegram: string;
  whatsapp: EvictionPhoneValue;
  instructions: string;
  agencyName: string;
}

const emptyState = (phoneCountry: string): EvictionFormState => ({
  title: '',
  description: '',
  label: '',
  city: '',
  date: null,
  time: '',
  phone: emptyEvictionPhone(phoneCountry),
  email: '',
  telegram: '',
  whatsapp: emptyEvictionPhone(phoneCountry),
  instructions: '',
  agencyName: '',
});

const buildInitialState = (
  existing: EvictionCase | undefined,
  phoneCountry: string,
): EvictionFormState => {
  if (!existing) return emptyState(phoneCountry);
  const { day, time } = splitDateAndTime(existing.scheduledAt);
  return {
    title: existing.title,
    // Withheld under a precautionary hold, in which case the organiser is
    // rewriting it anyway — an empty field is the honest starting point.
    description: existing.description ?? '',
    label: existing.location.label,
    city: existing.location.city ?? '',
    date: day,
    time,
    phone: splitEvictionPhone(existing.contactInfo?.phone, phoneCountry),
    email: existing.contactInfo?.email ?? '',
    telegram: existing.contactInfo?.telegram ?? '',
    whatsapp: splitEvictionPhone(existing.contactInfo?.whatsapp, phoneCountry),
    instructions: existing.contactInfo?.instructions ?? '',
    agencyName: '',
  };
};

interface EvictionFormProps {
  mode: 'create' | 'edit';
  editId?: string;
  existing?: EvictionCase;
}

const EvictionForm: React.FC<EvictionFormProps> = ({ mode, editId, existing }) => {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const mapRef = useRef<MapApi | null>(null);

  /**
   * The map seed when EDITING.
   *
   * It is the PUBLISHED centre, not the reported point — the reported point was
   * never stored (unless the household authorised it) and is not recoverable
   * here. An organiser re-saving without moving the pin therefore submits a
   * point inside the current disc, which the server recognises as "no change"
   * and does NOT redraw: each redraw is an independent sample around the true
   * point, and a watcher collecting several can average towards it.
   */
  const initialCoords = useMemo<LonLat | null>(() => {
    const published = existing?.location.approximateCoordinates;
    return published ? [published[0], published[1]] : null;
  }, [existing]);

  const [form, setForm] = useState<EvictionFormState>(() =>
    buildInitialState(
      existing,
      resolveDefaultPhoneCountry({
        caseCountryCode: existing?.location.countryCode,
        deviceRegion: getLocales()[0]?.regionCode,
        localeTag: i18n.language,
      }),
    ),
  );
  /**
   * Whether the affected household itself asked for the exact location to be
   * shareable.
   *
   * This is NOT a precision toggle. There is no value a client can send that
   * publishes an exact point — `EvictionPublicPrecision` has no `exact` member.
   * What this flag does is let the server STORE the reported point at all, so it
   * can later be shared with a named actor under a time-bounded, revocable,
   * audited grant. Off by default, and the CHECK constraint refuses the row if a
   * future caller writes the coordinates without it.
   */
  const [householdAuthorizedExact, setHouseholdAuthorizedExact] = useState(
    existing?.exactLocationAvailable ?? false,
  );
  const [coords, setCoords] = useState<LonLat | null>(initialCoords);
  const [cover, setCover] = useState<{ imageId?: string; url?: string } | undefined>(
    existing?.coverImage,
  );
  const [uploading, setUploading] = useState(false);

  const createMutation = useCreateEviction();
  const updateMutation = useUpdateEviction(editId ?? '');
  const submitting = createMutation.isPending || updateMutation.isPending;

  const initialCoordinates = initialCoords ?? undefined;

  const update = useCallback(
    <K extends keyof EvictionFormState>(key: K, value: EvictionFormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleAddressSelect = useCallback((address: GeocodedAddress, coordinates: LonLat) => {
    setCoords(coordinates);
    const composed =
      address.fullAddress ||
      [address.street, address.houseNumber].filter(Boolean).join(' ') ||
      address.neighborhood ||
      address.city ||
      '';
    setForm((prev) => {
      // A phone field the user has not touched follows the picked place, so a
      // case in Lisbon starts its numbers at +351 wherever the organiser is.
      const placeCountry = countryCodeFromPlace(address.country);
      const follow = (field: EvictionPhoneValue) =>
        placeCountry && !field.edited && field.original === undefined
          ? { ...field, country: placeCountry }
          : field;
      return {
        ...prev,
        label: composed || prev.label,
        city: address.city || prev.city,
        phone: follow(prev.phone),
        whatsapp: follow(prev.whatsapp),
      };
    });
  }, []);

  const handlePickCover = useCallback(async () => {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        toast.error(t('evictions.form.photoPermission'));
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (result.canceled || result.assets.length === 0) return;
    setUploading(true);
    try {
      const uploaded = await imageUploadService.uploadSingleImage(
        result.assets[0].uri,
        'evictions',
      );
      setCover({ imageId: uploaded.imageId, url: uploaded.urls.medium ?? uploaded.urls.original });
    } catch {
      toast.error(t('evictions.form.photoFailed'));
    } finally {
      setUploading(false);
    }
  }, [t]);

  const handleSubmit = useCallback(async () => {
    if (!form.title.trim()) {
      toast.error(t('evictions.form.titleRequired'));
      return;
    }
    if (!form.description.trim()) {
      toast.error(t('evictions.form.descriptionRequired'));
      return;
    }
    if (!coords) {
      toast.error(t('evictions.form.locationRequired'));
      return;
    }
    if (!form.label.trim()) {
      toast.error(t('evictions.form.labelRequired'));
      return;
    }
    const scheduledAt = combineDateAndTime(form.date, form.time);
    if (!scheduledAt) {
      toast.error(t('evictions.form.dateRequired'));
      return;
    }

    const contactInfo = {
      phone: joinEvictionPhone(form.phone),
      email: form.email.trim() || undefined,
      telegram: form.telegram.trim() || undefined,
      whatsapp: joinEvictionPhone(form.whatsapp),
      instructions: form.instructions.trim() || undefined,
    };
    const hasContact = Object.values(contactInfo).some((value) => value !== undefined);

    const payload: CreateEvictionCaseData = {
      title: form.title.trim(),
      description: form.description.trim(),
      location: {
        label: form.label.trim(),
        // The TRUE point the organiser dropped. The server derives the published
        // disc from it and, without the household's authorisation below, never
        // writes it anywhere.
        coordinates: [coords[0], coords[1]],
        city: form.city.trim() || undefined,
      },
      householdAuthorizedExact,
      scheduledAt,
      contactInfo: hasContact ? contactInfo : undefined,
      coverImage: cover?.imageId ? cover : undefined,
      agencyName: form.agencyName.trim() || undefined,
    };

    try {
      if (mode === 'edit' && editId) {
        await updateMutation.mutateAsync(payload);
        toast.success(t('evictions.form.updateSuccess'));
        router.replace(`/evictions/${editId}`);
      } else {
        const created = await createMutation.mutateAsync(payload);
        // The server says WHICH RULES it applied, by category, never the removed
        // value — echoing the number back would put it in a response body, and
        // this deployment logs those on error.
        if (created.removedForPrivacy.length > 0) {
          toast.success(
            t('evictions.form.removedForPrivacy', {
              rules: created.removedForPrivacy
                .map((rule) => t(`evictions.form.removed.${rule}`))
                .join(', '),
            }),
          );
        } else {
          toast.success(t('evictions.form.createSuccess'));
        }
        router.replace(`/evictions/${created.eviction.id}`);
      }
    } catch (submitError) {
      toast.error(
        submitError instanceof Error ? submitError.message : t('evictions.form.submitError'),
      );
    }
  }, [
    form,
    coords,
    householdAuthorizedExact,
    cover,
    mode,
    editId,
    updateMutation,
    createMutation,
    router,
    t,
  ]);

  const coverPreview = cover?.url ? resolveBackendImageUrl(cover.url) : undefined;

  return (
    <View style={styles.root}>
      <Header
        options={{
          showBackButton: true,
          title: mode === 'edit' ? t('evictions.form.editTitle') : t('evictions.form.title'),
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.titleBlock}>
            <SectionEyebrow>{t('evictions.eyebrow')}</SectionEyebrow>
            <H2 style={styles.pageTitle}>
              {mode === 'edit' ? t('evictions.form.editTitle') : t('evictions.form.title')}
            </H2>
            <BloomText style={styles.subtitle}>{t('evictions.form.subtitle')}</BloomText>
          </View>

          <Card variant="outlined" radius="radius-16" style={styles.section}>
            <CardTitle>{t('evictions.form.whatSection')}</CardTitle>
            <Field label={t('evictions.form.titleLabel')}>
              <TextFieldInput
                label={t('evictions.form.titleLabel')}
                placeholder={t('evictions.form.titlePlaceholder')}
                value={form.title}
                onChangeText={(text) => update('title', text)}
              />
            </Field>
            <Textarea
              label={t('evictions.form.descriptionLabel')}
              placeholder={t('evictions.form.descriptionPlaceholder')}
              value={form.description}
              onChangeText={(text) => update('description', text)}
              required
              rows={4}
              autoResize
              maxRows={12}
            />
          </Card>

          <Card variant="outlined" radius="radius-16" style={styles.section}>
            <CardTitle>{t('evictions.form.whereSection')}</CardTitle>
            <View style={styles.mapWrap}>
              <Map
                ref={mapRef}
                style={styles.mapInner}
                enableAddressLookup
                showAddressInstructions
                onAddressSelect={handleAddressSelect}
                initialCoordinates={initialCoordinates}
                startFromCurrentLocation={!initialCoordinates}
                screenId="eviction-create"
              />
            </View>
            <BloomText style={styles.hint}>{t('evictions.form.mapHint')}</BloomText>
            <Field label={t('evictions.form.labelLabel')}>
              <TextFieldInput
                label={t('evictions.form.labelLabel')}
                placeholder={t('evictions.form.labelPlaceholder')}
                value={form.label}
                onChangeText={(text) => update('label', text)}
              />
            </Field>
            <Field label={t('evictions.form.cityLabel')}>
              <TextFieldInput
                label={t('evictions.form.cityLabel')}
                placeholder={t('evictions.form.cityPlaceholder')}
                value={form.city}
                onChangeText={(text) => update('city', text)}
              />
            </Field>
            {/* The published pin is ALWAYS a disc — there is no control for
                that, because there is no value that publishes an exact point.
                What this asks is whether the affected household authorised
                storing the exact location so it can later be shared with a
                named actor under an expiring, revocable, audited grant. */}
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <BloomText style={styles.switchLabel}>
                  {t('evictions.form.householdAuthorizedLabel')}
                </BloomText>
                <BloomText style={styles.switchHint}>
                  {t('evictions.form.householdAuthorizedHint')}
                </BloomText>
              </View>
              <Switch
                value={householdAuthorizedExact}
                onValueChange={setHouseholdAuthorizedExact}
              />
            </View>
            <BloomText style={styles.switchHint}>
              {t('evictions.form.approximateAlwaysNotice')}
            </BloomText>
          </Card>

          <Card variant="outlined" radius="radius-16" style={styles.section}>
            <CardTitle>{t('evictions.form.whenSection')}</CardTitle>
            <View style={styles.row}>
              <Field label={t('evictions.form.dateLabel')} required style={styles.rowField}>
                <DatePicker
                  value={form.date}
                  onChange={(day) => update('date', day)}
                  locale={i18n.language}
                  accessibilityLabel={t('evictions.form.dateLabel')}
                />
              </Field>
              <View style={styles.rowField}>
                <Field label={t('evictions.form.timeLabel')}>
                  {/* `TimeField` commits on blur/submit and reverts a draft it
                      cannot parse, so `form.time` only ever holds a real 24h
                      `HH:mm` — the shape `combineDateAndTime` already required
                      and the free-text box could not promise. Empty is `null`
                      there and `''` here, which is the string the rest of the
                      form and `splitDateAndTime` speak. */}
                  <TimeField
                    value={form.time || null}
                    onChange={(time) => update('time', time ?? '')}
                    accessibilityLabel={t('evictions.form.timeLabel')}
                  />
                </Field>
              </View>
            </View>
          </Card>

          <Card variant="outlined" radius="radius-16" style={styles.section}>
            <CardTitle>{t('evictions.form.helpSection')}</CardTitle>
            <PhoneInput
              label={t('evictions.detail.contact.phone')}
              placeholder="600 000 000"
              country={form.phone.country}
              onCountryChange={(iso2) => update('phone', withPhoneCountry(form.phone, iso2))}
              value={form.phone.number}
              onChangeText={(number) => update('phone', withPhoneNumber(form.phone, number))}
            />
            <PhoneInput
              label={t('evictions.detail.contact.whatsapp')}
              placeholder="600 000 000"
              country={form.whatsapp.country}
              onCountryChange={(iso2) => update('whatsapp', withPhoneCountry(form.whatsapp, iso2))}
              value={form.whatsapp.number}
              onChangeText={(number) => update('whatsapp', withPhoneNumber(form.whatsapp, number))}
            />
            <Field label={t('evictions.detail.contact.telegram')}>
              <TextFieldInput
                label={t('evictions.detail.contact.telegram')}
                placeholder="@canal"
                value={form.telegram}
                onChangeText={(text) => update('telegram', text)}
                autoCapitalize="none"
              />
            </Field>
            <Field label={t('evictions.detail.contact.email')}>
              <TextFieldInput
                label={t('evictions.detail.contact.email')}
                placeholder="solidaridad@example.org"
                value={form.email}
                onChangeText={(text) => update('email', text)}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </Field>
            <Textarea
              label={t('evictions.form.instructionsLabel')}
              placeholder={t('evictions.form.instructionsPlaceholder')}
              value={form.instructions}
              onChangeText={(text) => update('instructions', text)}
              rows={3}
              autoResize
              maxRows={8}
            />
          </Card>

          <Card variant="outlined" radius="radius-16" style={styles.section}>
            <CardTitle>{t('evictions.form.agencySection')}</CardTitle>
            <Field label={t('evictions.form.agencyLabel')}>
              <TextFieldInput
                label={t('evictions.form.agencyLabel')}
                placeholder={t('evictions.form.agencyPlaceholder')}
                value={form.agencyName}
                onChangeText={(text) => update('agencyName', text)}
              />
            </Field>
          </Card>

          <Card variant="outlined" radius="radius-16" style={styles.section}>
            <CardTitle>{t('evictions.form.photoSection')}</CardTitle>
            {coverPreview ? (
              <Image
                source={{ uri: coverPreview }}
                style={styles.coverPreview}
                contentFit="cover"
                accessibilityIgnoresInvertColors
              />
            ) : null}
            <Button
              variant="secondary"
              size="medium"
              onPress={handlePickCover}
              loading={uploading}
              disabled={uploading}
              leadingIcon={RiImageAddLine}
              style={styles.photoButton}
            >
              {cover?.imageId ? t('evictions.form.photoChange') : t('evictions.form.photoAdd')}
            </Button>
          </Card>

          <Button
            variant="primary"
            size="large"
            onPress={handleSubmit}
            loading={submitting}
            disabled={submitting}
            style={styles.submit}
          >
            {mode === 'edit' ? t('evictions.form.saveChanges') : t('evictions.form.publish')}
          </Button>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
};

export default function EvictionsFormScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const editId = Array.isArray(edit) ? edit[0] : edit;
  const isEdit = Boolean(editId);

  const { data: existing, isLoading, isError } = useEvictionDetail(editId);

  if (isEdit && isLoading) {
    return (
      <View style={styles.root}>
        <Header options={{ showBackButton: true, title: t('evictions.form.editTitle') }} />
        <View style={styles.content}>
          <Skeleton.Box width="100%" height={48} borderRadius={radius.md} />
          <Skeleton.Box width="100%" height={200} borderRadius={radius.lg} />
          <Skeleton.Box width="100%" height={48} borderRadius={radius.md} />
        </View>
      </View>
    );
  }

  if (isEdit && (isError || !existing)) {
    return (
      <View style={styles.root}>
        <Header options={{ showBackButton: true, title: t('evictions.form.editTitle') }} />
        <ErrorState
          icon={RiAlertLine}
          title={t('evictions.loadError')}
          description={t('common.tryAgain')}
          retryLabel={t('common.goBack')}
          onRetry={() => router.back()}
        />
      </View>
    );
  }

  return (
    <EvictionForm
      mode={isEdit ? 'edit' : 'create'}
      editId={editId}
      existing={isEdit ? existing : undefined}
    />
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
    paddingBottom: spacing['5xl'],
  },
  titleBlock: {
    gap: spacing.xs,
  },
  pageTitle: {
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
  },
  section: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  mapWrap: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.mutedSubtle,
  },
  mapInner: {
    height: 260,
  },
  hint: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  rowField: {
    flex: 1,
    minWidth: 160,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  switchText: {
    flex: 1,
    gap: spacing.xs,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  switchHint: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  coverPreview: {
    width: '100%',
    height: 180,
    borderRadius: radius.md,
    backgroundColor: colors.mutedSubtle,
  },
  photoButton: {
    alignSelf: 'flex-start',
  },
  submit: {
    alignSelf: 'stretch',
  },
});
