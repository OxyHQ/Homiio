/**
 * Publish / edit an eviction case (publicar).
 *
 * Sectioned form (mirrors `app/reviews/write.tsx`): 1) Qué pasa (title +
 * description) · 2) Dónde (map address lookup → editable label + city + an
 * approximate-location Switch that rounds the pin server-side) · 3) Cuándo (date
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
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { Switch } from '@oxyhq/bloom/switch';
import { TextFieldInput } from '@oxyhq/bloom/text-field';
import { H2, H3, Text as BloomText } from '@oxyhq/bloom/typography';

import { CreateEvictionCaseData, EvictionCase } from '@homiio/shared-types';
import { Header } from '@/components/Header';
import Map, { type MapApi, type AddressData, type LonLat } from '@/components/Map';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { useCreateEviction, useEvictionDetail, useUpdateEviction } from '@/hooks/useEvictionQueries';
import { imageUploadService } from '@/services/imageUploadService';
import { resolveBackendImageUrl } from '@/utils/imageUrl';
import { toast } from '@/lib/sonner';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

interface EvictionFormState {
  title: string;
  description: string;
  label: string;
  city: string;
  date: string;
  time: string;
  phone: string;
  email: string;
  telegram: string;
  whatsapp: string;
  instructions: string;
  agencyName: string;
}

const EMPTY_STATE: EvictionFormState = {
  title: '',
  description: '',
  label: '',
  city: '',
  date: '',
  time: '',
  phone: '',
  email: '',
  telegram: '',
  whatsapp: '',
  instructions: '',
  agencyName: '',
};

/** Split an ISO date into the `YYYY-MM-DD` + `HH:mm` the form edits (local time). */
const isoToParts = (iso: string): { date: string; time: string } => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return { date: '', time: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`,
    time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`,
  };
};

const buildInitialState = (existing?: EvictionCase): EvictionFormState => {
  if (!existing) return EMPTY_STATE;
  const { date, time } = isoToParts(existing.scheduledAt);
  return {
    title: existing.title,
    description: existing.description,
    label: existing.location.label,
    city: existing.location.city ?? '',
    date,
    time,
    phone: existing.contactInfo?.phone ?? '',
    email: existing.contactInfo?.email ?? '',
    telegram: existing.contactInfo?.telegram ?? '',
    whatsapp: existing.contactInfo?.whatsapp ?? '',
    instructions: existing.contactInfo?.instructions ?? '',
    agencyName: '',
  };
};

/** Combine the `YYYY-MM-DD` + optional `HH:mm` fields into an ISO string. */
const partsToIso = (date: string, time: string): string | undefined => {
  const trimmed = date.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(`${trimmed}T${time.trim() || '00:00'}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

interface EvictionFormProps {
  mode: 'create' | 'edit';
  editId?: string;
  existing?: EvictionCase;
}

const EvictionForm: React.FC<EvictionFormProps> = ({ mode, editId, existing }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const mapRef = useRef<MapApi | null>(null);

  // The case being edited is fixed for this form's lifetime, so its coordinates
  // are a stable seed for the map center (later taps move the pin imperatively).
  const initialCoords = useMemo<LonLat | null>(() => {
    const c = existing?.location.coordinates?.coordinates;
    return Array.isArray(c) && c.length === 2 ? [c[0], c[1]] : null;
  }, [existing]);

  const [form, setForm] = useState<EvictionFormState>(() => buildInitialState(existing));
  const [approximate, setApproximate] = useState(existing?.location.precision !== 'exact');
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

  const handleAddressSelect = useCallback((address: AddressData, coordinates: LonLat) => {
    setCoords(coordinates);
    const composed =
      address.fullAddress ||
      [address.street, address.houseNumber].filter(Boolean).join(' ') ||
      address.neighborhood ||
      address.city ||
      '';
    setForm((prev) => ({
      ...prev,
      label: composed || prev.label,
      city: address.city || prev.city,
    }));
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
      const uploaded = await imageUploadService.uploadSingleImage(result.assets[0].uri, 'evictions');
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
    const scheduledAt = partsToIso(form.date, form.time);
    if (!scheduledAt) {
      toast.error(t('evictions.form.dateRequired'));
      return;
    }

    const contactInfo = {
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      telegram: form.telegram.trim() || undefined,
      whatsapp: form.whatsapp.trim() || undefined,
      instructions: form.instructions.trim() || undefined,
    };
    const hasContact = Object.values(contactInfo).some((value) => value !== undefined);

    const payload: CreateEvictionCaseData = {
      title: form.title.trim(),
      description: form.description.trim(),
      location: {
        label: form.label.trim(),
        coordinates: { type: 'Point', coordinates: [coords[0], coords[1]] },
        precision: approximate ? 'approximate' : 'exact',
        city: form.city.trim() || undefined,
      },
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
        toast.success(t('evictions.form.createSuccess'));
        router.replace(`/evictions/${created.id}`);
      }
    } catch (submitError) {
      toast.error(
        submitError instanceof Error ? submitError.message : t('evictions.form.submitError'),
      );
    }
  }, [form, coords, approximate, cover, mode, editId, updateMutation, createMutation, router, t]);

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

          <View style={styles.section}>
            <H3 style={styles.sectionTitle}>{t('evictions.form.whatSection')}</H3>
            <TextFieldInput
              label={t('evictions.form.titleLabel')}
              placeholder={t('evictions.form.titlePlaceholder')}
              value={form.title}
              onChangeText={(text) => update('title', text)}
            />
            <TextFieldInput
              label={t('evictions.form.descriptionLabel')}
              placeholder={t('evictions.form.descriptionPlaceholder')}
              value={form.description}
              onChangeText={(text) => update('description', text)}
              multiline
            />
          </View>

          <View style={styles.section}>
            <H3 style={styles.sectionTitle}>{t('evictions.form.whereSection')}</H3>
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
            <TextFieldInput
              label={t('evictions.form.labelLabel')}
              placeholder={t('evictions.form.labelPlaceholder')}
              value={form.label}
              onChangeText={(text) => update('label', text)}
            />
            <TextFieldInput
              label={t('evictions.form.cityLabel')}
              placeholder={t('evictions.form.cityPlaceholder')}
              value={form.city}
              onChangeText={(text) => update('city', text)}
            />
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <BloomText style={styles.switchLabel}>
                  {t('evictions.form.approximateLabel')}
                </BloomText>
                <BloomText style={styles.switchHint}>
                  {t('evictions.form.approximateHint')}
                </BloomText>
              </View>
              <Switch value={approximate} onValueChange={setApproximate} />
            </View>
          </View>

          <View style={styles.section}>
            <H3 style={styles.sectionTitle}>{t('evictions.form.whenSection')}</H3>
            <View style={styles.row}>
              <View style={styles.rowField}>
                <TextFieldInput
                  label={t('evictions.form.dateLabel')}
                  placeholder="YYYY-MM-DD"
                  value={form.date}
                  onChangeText={(text) => update('date', text)}
                />
              </View>
              <View style={styles.rowField}>
                <TextFieldInput
                  label={t('evictions.form.timeLabel')}
                  placeholder="HH:MM"
                  value={form.time}
                  onChangeText={(text) => update('time', text)}
                />
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <H3 style={styles.sectionTitle}>{t('evictions.form.helpSection')}</H3>
            <TextFieldInput
              label={t('evictions.detail.contact.phone')}
              placeholder="+34 600 000 000"
              value={form.phone}
              onChangeText={(text) => update('phone', text)}
              keyboardType="phone-pad"
            />
            <TextFieldInput
              label={t('evictions.detail.contact.whatsapp')}
              placeholder="+34 600 000 000"
              value={form.whatsapp}
              onChangeText={(text) => update('whatsapp', text)}
            />
            <TextFieldInput
              label={t('evictions.detail.contact.telegram')}
              placeholder="@canal"
              value={form.telegram}
              onChangeText={(text) => update('telegram', text)}
              autoCapitalize="none"
            />
            <TextFieldInput
              label={t('evictions.detail.contact.email')}
              placeholder="solidaridad@example.org"
              value={form.email}
              onChangeText={(text) => update('email', text)}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TextFieldInput
              label={t('evictions.form.instructionsLabel')}
              placeholder={t('evictions.form.instructionsPlaceholder')}
              value={form.instructions}
              onChangeText={(text) => update('instructions', text)}
              multiline
            />
          </View>

          <View style={styles.section}>
            <H3 style={styles.sectionTitle}>{t('evictions.form.agencySection')}</H3>
            <TextFieldInput
              label={t('evictions.form.agencyLabel')}
              placeholder={t('evictions.form.agencyPlaceholder')}
              value={form.agencyName}
              onChangeText={(text) => update('agencyName', text)}
            />
          </View>

          <View style={styles.section}>
            <H3 style={styles.sectionTitle}>{t('evictions.form.photoSection')}</H3>
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
              icon={<Ionicons name="image-outline" size={18} color={colors.text} />}
              iconPosition="left"
              style={styles.photoButton}
            >
              {cover?.imageId ? t('evictions.form.photoChange') : t('evictions.form.photoAdd')}
            </Button>
          </View>

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
          icon="cloud-offline-outline"
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
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  sectionTitle: {
    letterSpacing: -0.3,
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
    gap: spacing.md,
  },
  rowField: {
    flex: 1,
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
