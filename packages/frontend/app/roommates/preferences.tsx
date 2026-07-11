/**
 * Roommate preferences — editable matching profile.
 *
 * Toggles roommate matching and edits the matching-preference fields
 * (`RoommateMatchingPreferences` from shared-types: budget, ageRange, gender,
 * lifestyle, move-in, lease length). Saving PUTs the preferences to
 * `PUT /api/roommates/preferences` via `roommateService.updateRoommatePreferences`.
 */
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@oxyhq/bloom/button';
import { Switch } from '@oxyhq/bloom/switch';
import { H2, H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { useTranslation } from 'react-i18next';
import { LeaseDuration } from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { useProfile } from '@/context/ProfileContext';
import { roommateService, type RoommateMatchingPreferences } from '@/services/roommateService';
import { useProfileStore } from '@/store/profileStore';
import { radius, spacing } from '@/constants/styles';
import { colors } from '@/styles/colors';

type LifestyleChoice = 'yes' | 'no' | 'prefer_not';
type Cleanliness = 'very_clean' | 'clean' | 'average' | 'relaxed';
type Schedule = 'early_bird' | 'night_owl' | 'flexible';
type GenderPref = 'male' | 'female' | 'any';

interface FormState {
  budgetMin: string;
  budgetMax: string;
  ageMin: string;
  ageMax: string;
  moveInDate: string;
  leaseDuration: LeaseDuration;
  gender: GenderPref;
  smoking: LifestyleChoice;
  pets: LifestyleChoice;
  partying: LifestyleChoice;
  cleanliness: Cleanliness;
  schedule: Schedule;
}

const DEFAULT_FORM: FormState = {
  budgetMin: '',
  budgetMax: '',
  ageMin: '',
  ageMax: '',
  moveInDate: '',
  leaseDuration: LeaseDuration.FLEXIBLE,
  gender: 'any',
  smoking: 'prefer_not',
  pets: 'prefer_not',
  partying: 'prefer_not',
  cleanliness: 'clean',
  schedule: 'flexible',
};

const GENDER_OPTIONS: { value: GenderPref; labelKey: string }[] = [
  { value: 'any', labelKey: 'roommates.preferencesPage.options.gender.any' },
  { value: 'male', labelKey: 'roommates.preferencesPage.options.gender.male' },
  { value: 'female', labelKey: 'roommates.preferencesPage.options.gender.female' },
];

const LIFESTYLE_OPTIONS: { value: LifestyleChoice; labelKey: string }[] = [
  { value: 'yes', labelKey: 'roommates.preferencesPage.options.lifestyle.yes' },
  { value: 'no', labelKey: 'roommates.preferencesPage.options.lifestyle.no' },
  { value: 'prefer_not', labelKey: 'roommates.preferencesPage.options.lifestyle.prefer_not' },
];

const CLEANLINESS_OPTIONS: { value: Cleanliness; labelKey: string }[] = [
  { value: 'very_clean', labelKey: 'roommates.preferencesPage.options.cleanliness.very_clean' },
  { value: 'clean', labelKey: 'roommates.preferencesPage.options.cleanliness.clean' },
  { value: 'average', labelKey: 'roommates.preferencesPage.options.cleanliness.average' },
  { value: 'relaxed', labelKey: 'roommates.preferencesPage.options.cleanliness.relaxed' },
];

const SCHEDULE_OPTIONS: { value: Schedule; labelKey: string }[] = [
  { value: 'early_bird', labelKey: 'roommates.preferencesPage.options.schedule.early_bird' },
  { value: 'night_owl', labelKey: 'roommates.preferencesPage.options.schedule.night_owl' },
  { value: 'flexible', labelKey: 'roommates.preferencesPage.options.schedule.flexible' },
];

const LEASE_OPTIONS: { value: LeaseDuration; labelKey: string }[] = [
  { value: LeaseDuration.MONTHLY, labelKey: 'roommates.preferencesPage.options.lease.monthly' },
  { value: LeaseDuration.THREE_MONTHS, labelKey: 'roommates.preferencesPage.options.lease.3_months' },
  { value: LeaseDuration.SIX_MONTHS, labelKey: 'roommates.preferencesPage.options.lease.6_months' },
  { value: LeaseDuration.YEARLY, labelKey: 'roommates.preferencesPage.options.lease.yearly' },
  { value: LeaseDuration.FLEXIBLE, labelKey: 'roommates.preferencesPage.options.lease.flexible' },
];

function toNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** A selectable option chip. Owns its own pressed state (NativeWind-safe). */
const Chip: React.FC<{
  label: string;
  selected: boolean;
  onPress: () => void;
}> = ({ label, selected, onPress }) => {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.chip,
        selected && styles.chipSelected,
        pressed && !selected && styles.chipPressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <BloomText style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </BloomText>
    </Pressable>
  );
};

function ChipRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; labelKey: string }[];
  onChange: (next: T) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.field}>
      <BloomText style={styles.fieldLabel}>{label}</BloomText>
      <View style={styles.chipWrap}>
        {options.map((option) => (
          <Chip
            key={option.value}
            label={t(option.labelKey)}
            selected={option.value === value}
            onPress={() => onChange(option.value)}
          />
        ))}
      </View>
    </View>
  );
}

function seedForm(prefs: RoommateMatchingPreferences | null | undefined): FormState {
  if (!prefs) return DEFAULT_FORM;
  return {
    budgetMin: prefs.budget?.min != null ? String(prefs.budget.min) : '',
    budgetMax: prefs.budget?.max != null ? String(prefs.budget.max) : '',
    ageMin: prefs.ageRange?.min != null ? String(prefs.ageRange.min) : '',
    ageMax: prefs.ageRange?.max != null ? String(prefs.ageRange.max) : '',
    moveInDate: prefs.moveInDate ?? '',
    leaseDuration: prefs.leaseDuration ?? LeaseDuration.FLEXIBLE,
    gender: prefs.gender ?? 'any',
    smoking: prefs.lifestyle?.smoking ?? 'prefer_not',
    pets: prefs.lifestyle?.pets ?? 'prefer_not',
    partying: prefs.lifestyle?.partying ?? 'prefer_not',
    cleanliness: prefs.lifestyle?.cleanliness ?? 'clean',
    schedule: prefs.lifestyle?.schedule ?? 'flexible',
  };
}

function toPreferences(form: FormState): RoommateMatchingPreferences {
  return {
    budget: { min: toNumber(form.budgetMin) ?? 0, max: toNumber(form.budgetMax) ?? 0 },
    ageRange: { min: toNumber(form.ageMin) ?? 0, max: toNumber(form.ageMax) ?? 0 },
    gender: form.gender,
    moveInDate: form.moveInDate.trim() || undefined,
    leaseDuration: form.leaseDuration,
    lifestyle: {
      smoking: form.smoking,
      pets: form.pets,
      partying: form.partying,
      cleanliness: form.cleanliness,
      schedule: form.schedule,
    },
  };
}

export default function RoommatePreferencesPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [roommateEnabled, setRoommateEnabled] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const { profile, hasProfile } = useProfile();

  const profileSettingsKey = hasProfile ? profile : null;
  const [prevProfileSettingsKey, setPrevProfileSettingsKey] = useState(profileSettingsKey);
  if (profileSettingsKey !== prevProfileSettingsKey) {
    setPrevProfileSettingsKey(profileSettingsKey);
    const roommateSettings = profileSettingsKey?.personalProfile?.settings?.roommate;
    if (roommateSettings) {
      setRoommateEnabled(Boolean(roommateSettings.enabled));
    }
  }

  const preferencesQuery = useQuery({
    queryKey: ['roommates', 'preferences'],
    queryFn: async () => roommateService.getMyRoommatePreferences(),
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 10,
  });

  // Merge server-saved preferences into the form once the query resolves.
  const preferencesData = preferencesQuery.data;
  const [prevPreferencesData, setPrevPreferencesData] = useState(preferencesData);
  if (preferencesData !== prevPreferencesData) {
    setPrevPreferencesData(preferencesData);
    if (preferencesData) {
      setForm(seedForm(preferencesData));
    }
  }

  const saveMutation = useMutation({
    mutationKey: ['roommates', 'savePreferences'],
    mutationFn: async (vars: { preferences: RoommateMatchingPreferences; enabled: boolean }) =>
      roommateService.updateRoommatePreferences(vars.preferences, vars.enabled),
    onSuccess: async () => {
      await useProfileStore.getState().fetchProfile();
      await queryClient.invalidateQueries({ queryKey: ['roommates', 'preferences'] });
      await queryClient.invalidateQueries({ queryKey: ['roommates', 'status'] });
      Alert.alert(t('roommates.alert.successTitle'), t('roommates.alert.preferencesSaved'));
    },
    onError: () => {
      Alert.alert(t('roommates.alert.errorTitle'), t('roommates.alert.preferencesFailed'));
    },
  });

  const handleSave = () => {
    saveMutation.mutate({ preferences: toPreferences(form), enabled: roommateEnabled });
  };

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  if (!hasProfile || !hasProfile) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            title: t('roommates.preferencesPage.title'),
            showBackButton: true,
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="person-outline"
              title={t('roommates.preferencesPage.personalProfileRequired')}
              description={t('roommates.preferencesPage.personalProfileDescription')}
              actionText={t('roommates.preferencesPage.switchToPersonal')}
              actionIcon="person-circle"
              onAction={() => router.push('/profile')}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Header
        options={{
          title: t('roommates.preferencesPage.title'),
          showBackButton: true,
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.titleBlock}>
            <SectionEyebrow>{t('roommates.preferencesPage.eyebrow')}</SectionEyebrow>
            <H2 style={styles.title}>{t('roommates.preferences')}</H2>
            <BloomText style={styles.subtitle}>{t('roommates.preferencesPage.subtitle')}</BloomText>
          </View>

          <View style={styles.card}>
            <View style={styles.toggleHeader}>
              <View style={styles.toggleHeaderText}>
                <BloomText style={styles.toggleTitle}>
                  {t('roommates.preferencesPage.enableTitle')}
                </BloomText>
                <BloomText style={styles.toggleDescription}>
                  {t('roommates.preferencesPage.enableDescription')}
                </BloomText>
              </View>
              <Switch value={roommateEnabled} onValueChange={setRoommateEnabled} />
            </View>
          </View>

          <View style={styles.card}>
            <H3 style={styles.cardTitle}>{t('roommates.preferencesPage.budgetTimeline')}</H3>
            <View style={styles.field}>
              <BloomText style={styles.fieldLabel}>{t('roommates.preferencesPage.monthlyBudget')}</BloomText>
              <View style={styles.inlineInputs}>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  placeholder={t('roommates.preferencesPage.min')}
                  placeholderTextColor={colors.muted}
                  value={form.budgetMin}
                  onChangeText={(text) => updateField('budgetMin', text)}
                />
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  placeholder={t('roommates.preferencesPage.max')}
                  placeholderTextColor={colors.muted}
                  value={form.budgetMax}
                  onChangeText={(text) => updateField('budgetMax', text)}
                />
              </View>
            </View>
            <View style={styles.field}>
              <BloomText style={styles.fieldLabel}>{t('roommates.preferencesPage.moveInDate')}</BloomText>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.muted}
                value={form.moveInDate}
                onChangeText={(text) => updateField('moveInDate', text)}
              />
            </View>
            <ChipRow
              label={t('roommates.preferencesPage.leaseLength')}
              value={form.leaseDuration}
              options={LEASE_OPTIONS}
              onChange={(v) => updateField('leaseDuration', v)}
            />
          </View>

          <View style={styles.card}>
            <H3 style={styles.cardTitle}>{t('roommates.preferencesPage.roommateSection')}</H3>
            <ChipRow
              label={t('roommates.preferencesPage.preferredGender')}
              value={form.gender}
              options={GENDER_OPTIONS}
              onChange={(v) => updateField('gender', v)}
            />
            <View style={styles.field}>
              <BloomText style={styles.fieldLabel}>{t('roommates.preferencesPage.ageRange')}</BloomText>
              <View style={styles.inlineInputs}>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  placeholder={t('roommates.preferencesPage.min')}
                  placeholderTextColor={colors.muted}
                  value={form.ageMin}
                  onChangeText={(text) => updateField('ageMin', text)}
                />
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  placeholder={t('roommates.preferencesPage.max')}
                  placeholderTextColor={colors.muted}
                  value={form.ageMax}
                  onChangeText={(text) => updateField('ageMax', text)}
                />
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <H3 style={styles.cardTitle}>{t('roommates.preferencesPage.lifestyle')}</H3>
            <ChipRow
              label={t('roommates.preferencesPage.smoking')}
              value={form.smoking}
              options={LIFESTYLE_OPTIONS}
              onChange={(v) => updateField('smoking', v)}
            />
            <ChipRow
              label={t('roommates.preferencesPage.pets')}
              value={form.pets}
              options={LIFESTYLE_OPTIONS}
              onChange={(v) => updateField('pets', v)}
            />
            <ChipRow
              label={t('roommates.preferencesPage.partying')}
              value={form.partying}
              options={LIFESTYLE_OPTIONS}
              onChange={(v) => updateField('partying', v)}
            />
            <ChipRow
              label={t('roommates.preferencesPage.cleanliness')}
              value={form.cleanliness}
              options={CLEANLINESS_OPTIONS}
              onChange={(v) => updateField('cleanliness', v)}
            />
            <ChipRow
              label={t('roommates.preferencesPage.schedule')}
              value={form.schedule}
              options={SCHEDULE_OPTIONS}
              onChange={(v) => updateField('schedule', v)}
            />
          </View>

          <Button
            variant="primary"
            size="large"
            onPress={handleSave}
            disabled={saveMutation.isPending}
            style={styles.saveButton}
          >
            {saveMutation.isPending ? t('roommates.preferencesPage.saving') : t('roommates.preferencesPage.save')}
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
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
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
  card: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    letterSpacing: -0.3,
    marginBottom: spacing.xs,
  },
  toggleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  toggleHeaderText: {
    flex: 1,
    gap: 2,
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  toggleDescription: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  inlineInputs: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.COLOR_BLACK,
    backgroundColor: colors.background,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.mutedSubtle,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: colors.COLOR_BLACK,
    borderColor: colors.COLOR_BLACK,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  chipTextSelected: {
    color: colors.white,
  },
  saveButton: {
    alignSelf: 'stretch',
  },
});
