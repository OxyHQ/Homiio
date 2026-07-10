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
import { LeaseDuration } from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { useProfile } from '@/context/ProfileContext';
import { roommateService, type RoommateMatchingPreferences } from '@/services/roommateService';
import { useProfileStore } from '@/store/profileStore';
import { radius, spacing, withShadow } from '@/constants/styles';
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

const GENDER_OPTIONS: { value: GenderPref; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

const LIFESTYLE_OPTIONS: { value: LifestyleChoice; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'prefer_not', label: 'No pref.' },
];

const CLEANLINESS_OPTIONS: { value: Cleanliness; label: string }[] = [
  { value: 'very_clean', label: 'Very clean' },
  { value: 'clean', label: 'Clean' },
  { value: 'average', label: 'Average' },
  { value: 'relaxed', label: 'Relaxed' },
];

const SCHEDULE_OPTIONS: { value: Schedule; label: string }[] = [
  { value: 'early_bird', label: 'Early bird' },
  { value: 'night_owl', label: 'Night owl' },
  { value: 'flexible', label: 'Flexible' },
];

const LEASE_OPTIONS: { value: LeaseDuration; label: string }[] = [
  { value: LeaseDuration.MONTHLY, label: 'Monthly' },
  { value: LeaseDuration.THREE_MONTHS, label: '3 months' },
  { value: LeaseDuration.SIX_MONTHS, label: '6 months' },
  { value: LeaseDuration.YEARLY, label: 'Yearly' },
  { value: LeaseDuration.FLEXIBLE, label: 'Flexible' },
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
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.field}>
      <BloomText style={styles.fieldLabel}>{label}</BloomText>
      <View style={styles.chipWrap}>
        {options.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const [roommateEnabled, setRoommateEnabled] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const { primaryProfile, isPersonalProfile, hasPersonalProfile } = useProfile();

  // Seed the enabled flag from the personal profile's saved settings.
  const profileSettingsKey = isPersonalProfile ? primaryProfile : null;
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
      await useProfileStore.getState().fetchPrimaryProfile();
      await queryClient.invalidateQueries({ queryKey: ['roommates', 'preferences'] });
      await queryClient.invalidateQueries({ queryKey: ['roommates', 'status'] });
      Alert.alert('Saved', 'Your roommate preferences were updated.');
    },
    onError: () => {
      Alert.alert('Error', 'Failed to save roommate preferences. Please try again.');
    },
  });

  const handleSave = () => {
    saveMutation.mutate({ preferences: toPreferences(form), enabled: roommateEnabled });
  };

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  if (!isPersonalProfile || !hasPersonalProfile) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            title: 'Roommate preferences',
            showBackButton: true,
            titlePosition: 'center',
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="person-outline"
              title="Personal profile required"
              description="Roommate preferences are only available for personal profiles. Please switch to your personal profile to manage your roommate settings."
              actionText="Switch to personal profile"
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
          title: 'Roommate preferences',
          showBackButton: true,
          titlePosition: 'center',
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.titleBlock}>
            <SectionEyebrow>Sharing a place</SectionEyebrow>
            <H2 style={styles.title}>Roommate matching</H2>
            <BloomText style={styles.subtitle}>
              Let other Homiio users find you when their preferences and yours
              line up.
            </BloomText>
          </View>

          <View style={styles.card}>
            <View style={styles.toggleHeader}>
              <View style={styles.toggleHeaderText}>
                <BloomText style={styles.toggleTitle}>
                  Enable roommate matching
                </BloomText>
                <BloomText style={styles.toggleDescription}>
                  Allow other users to discover your profile for matching.
                </BloomText>
              </View>
              <Switch value={roommateEnabled} onValueChange={setRoommateEnabled} />
            </View>
          </View>

          <View style={styles.card}>
            <H3 style={styles.cardTitle}>Budget & timeline</H3>
            <View style={styles.field}>
              <BloomText style={styles.fieldLabel}>Monthly budget (€)</BloomText>
              <View style={styles.inlineInputs}>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  placeholder="Min"
                  placeholderTextColor={colors.muted}
                  value={form.budgetMin}
                  onChangeText={(t) => updateField('budgetMin', t)}
                />
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  placeholder="Max"
                  placeholderTextColor={colors.muted}
                  value={form.budgetMax}
                  onChangeText={(t) => updateField('budgetMax', t)}
                />
              </View>
            </View>
            <View style={styles.field}>
              <BloomText style={styles.fieldLabel}>Move-in date</BloomText>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.muted}
                value={form.moveInDate}
                onChangeText={(t) => updateField('moveInDate', t)}
              />
            </View>
            <ChipRow
              label="Lease length"
              value={form.leaseDuration}
              options={LEASE_OPTIONS}
              onChange={(v) => updateField('leaseDuration', v)}
            />
          </View>

          <View style={styles.card}>
            <H3 style={styles.cardTitle}>Roommate</H3>
            <ChipRow
              label="Preferred gender"
              value={form.gender}
              options={GENDER_OPTIONS}
              onChange={(v) => updateField('gender', v)}
            />
            <View style={styles.field}>
              <BloomText style={styles.fieldLabel}>Age range</BloomText>
              <View style={styles.inlineInputs}>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  placeholder="Min"
                  placeholderTextColor={colors.muted}
                  value={form.ageMin}
                  onChangeText={(t) => updateField('ageMin', t)}
                />
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  placeholder="Max"
                  placeholderTextColor={colors.muted}
                  value={form.ageMax}
                  onChangeText={(t) => updateField('ageMax', t)}
                />
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <H3 style={styles.cardTitle}>Lifestyle</H3>
            <ChipRow
              label="Smoking"
              value={form.smoking}
              options={LIFESTYLE_OPTIONS}
              onChange={(v) => updateField('smoking', v)}
            />
            <ChipRow
              label="Pets"
              value={form.pets}
              options={LIFESTYLE_OPTIONS}
              onChange={(v) => updateField('pets', v)}
            />
            <ChipRow
              label="Partying"
              value={form.partying}
              options={LIFESTYLE_OPTIONS}
              onChange={(v) => updateField('partying', v)}
            />
            <ChipRow
              label="Cleanliness"
              value={form.cleanliness}
              options={CLEANLINESS_OPTIONS}
              onChange={(v) => updateField('cleanliness', v)}
            />
            <ChipRow
              label="Schedule"
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
            {saveMutation.isPending ? 'Saving…' : 'Save preferences'}
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
    ...withShadow('sm'),
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
