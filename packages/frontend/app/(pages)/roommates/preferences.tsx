/**
 * Roommate preferences — editable matching profile.
 *
 * Toggles roommate matching and edits the matching-preference fields
 * (`RoommateMatchingPreferences` from shared-types: budget, ageRange, gender,
 * lifestyle, move-in, lease length). Saving PUTs the preferences to
 * `PUT /api/roommates/preferences` via `roommateService.updateRoommatePreferences`.
 *
 * Built from Bloom: `Card` sections, `Field` + `TextFieldInput` numbers, a
 * `DatePicker` move-in date (stored as `YYYY-MM-DD`, converted at the
 * boundary), `Chip` option rows, `Switch`, and a `toast` for the save outcome.
 */
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { Chip } from '@oxy.so/bloom/chip';
import { DatePicker } from '@oxy.so/bloom/date-picker';
import { Field } from '@oxy.so/bloom/field';
import { Switch } from '@oxy.so/bloom/switch';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { H2, H3, Text as BloomText } from '@oxy.so/bloom/typography';
import { useTranslation } from 'react-i18next';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { LeaseDuration } from '@homiio/shared-types/common';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { useProfile } from '@/context/ProfileContext';
import {
  accountOwnerKey,
  type AccountOwner,
  useAccountOwnerGuard,
  withAccountOwner,
} from '@/hooks/useAccountOwner';
import { roommateService, type RoommateMatchingPreferences } from '@/services/roommateService';
import { spacing } from '@/constants/styles';
import { RiAccountCircleLine } from '@oxy.so/bloom/icons/RiAccountCircleLine';
import { RiUserLine } from '@oxy.so/bloom/icons/RiUserLine';

type LifestyleChoice = 'yes' | 'no' | 'prefer_not';
type Cleanliness = 'very_clean' | 'clean' | 'average' | 'relaxed';
type Schedule = 'early_bird' | 'night_owl' | 'flexible';
type GenderPref = 'male' | 'female' | 'any';

interface FormState {
  budgetMin: string;
  budgetMax: string;
  ageMin: string;
  ageMax: string;
  /** `YYYY-MM-DD`, or `''` for no preference — the shape the API stores. */
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
  {
    value: LeaseDuration.THREE_MONTHS,
    labelKey: 'roommates.preferencesPage.options.lease.3_months',
  },
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

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** `YYYY-MM-DD` (or a full ISO string) → a local-midnight `Date`, or `null`. */
function parseDay(value: string): Date | null {
  const match = ISO_DAY.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A local `Date` → the `YYYY-MM-DD` string the preferences API stores. */
function formatDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function ChipRow<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; labelKey: string }[];
  onChange: (next: T) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Field label={label}>
      <View style={styles.chipWrap} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Chip
              key={option.value}
              variant={selected ? 'solid' : 'outlined'}
              color={selected ? 'primary' : 'default'}
              selected={selected}
              disabled={disabled}
              onPress={() => onChange(option.value)}
            >
              {t(option.labelKey)}
            </Chip>
          );
        })}
      </View>
    </Field>
  );
}

/** A min/max pair of numeric Bloom inputs under one field label. */
function RangeInputs({
  label,
  min,
  max,
  onMinChange,
  onMaxChange,
  disabled,
}: {
  label: string;
  min: string;
  max: string;
  onMinChange: (text: string) => void;
  onMaxChange: (text: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Field label={label}>
      <View style={styles.inlineInputs}>
        <View style={styles.inlineInput}>
          <TextFieldInput
            label={t('roommates.preferencesPage.min')}
            keyboardType="numeric"
            disabled={disabled}
            value={min}
            onChangeText={onMinChange}
          />
        </View>
        <View style={styles.inlineInput}>
          <TextFieldInput
            label={t('roommates.preferencesPage.max')}
            keyboardType="numeric"
            disabled={disabled}
            value={max}
            onChangeText={onMaxChange}
          />
        </View>
      </View>
    </Field>
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
  const { owner, isCurrent } = useAccountOwnerGuard();
  if (!owner?.sessionId) return <UnavailablePreferences />;
  return (
    <OwnedPreferences
      key={JSON.stringify(accountOwnerKey(owner))}
      owner={owner}
      isCurrent={isCurrent}
    />
  );
}

function UnavailablePreferences() {
  const { t } = useTranslation();
  return (
    <Screen documentScroll>
      <ScreenScrollView contentContainerStyle={styles.emptyWrap}>
        <BloomText accessibilityRole="alert">
          {t('contracts.detail.signAccountUnavailable')}
        </BloomText>
      </ScreenScrollView>
    </Screen>
  );
}

function OwnedPreferences({
  owner,
  isCurrent,
}: {
  owner: AccountOwner;
  isCurrent: (owner: AccountOwner | null) => boolean;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [roommateEnabled, setRoommateEnabled] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [formDirty, setFormDirty] = useState(false);
  const [matchingDirty, setMatchingDirty] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const { hasProfile, refreshProfile, isProfileProjectionCurrent } = useProfile();
  const refreshOwners = useRef(
    new WeakMap<object, { refresh: typeof refreshProfile; isCurrent: () => boolean }>(),
  );

  const ownerKey = accountOwnerKey(owner);
  const settingsKey = ['roommates', 'preferences', ...ownerKey] as const;
  const settingsQuery = useQuery({
    queryKey: settingsKey,
    queryFn: () =>
      withAccountOwner(owner, async (current) => {
        const [preferences, status] = await Promise.all([
          roommateService.getMyRoommatePreferences(undefined, undefined, current),
          roommateService.getMyRoommateStatus(undefined, undefined, current),
        ]);
        if (!status) throw new Error('Invalid roommate status response');
        return { preferences, status };
      }),
    staleTime: 0,
    refetchOnMount: 'always',
    gcTime: 1000 * 60 * 10,
  });

  const refetchSettings = settingsQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      if (isCurrent(owner)) void refetchSettings();
    }, [owner, isCurrent, refetchSettings]),
  );

  const settings = settingsQuery.data;
  const [previousSettings, setPreviousSettings] = useState<typeof settings>(undefined);
  if (settings !== previousSettings) {
    setPreviousSettings(settings);
    if (settings) {
      if (
        previousSettings &&
        ((formDirty && settings.preferences !== previousSettings.preferences) ||
          (matchingDirty &&
            settings.status.hasRoommateMatching !== previousSettings.status.hasRoommateMatching))
      )
        setConflicted(true);
      if (!formDirty) setForm(settings.preferences ? seedForm(settings.preferences) : DEFAULT_FORM);
      if (!matchingDirty) setRoommateEnabled(settings.status.hasRoommateMatching);
    }
  }

  const saveMutation = useMutation({
    mutationKey: ['roommates', 'savePreferences', ...ownerKey],
    mutationFn: async (vars: { preferences: RoommateMatchingPreferences; enabled: boolean }) => {
      if (!isCurrent(owner) || !refreshOwners.current.get(vars)?.isCurrent())
        throw new Error('The active account changed');
      return withAccountOwner(owner, (current) =>
        roommateService.updateRoommatePreferences(vars.preferences, vars.enabled, current),
      );
    },
    onSuccess: async (_result, variables) => {
      const guard = refreshOwners.current.get(variables);
      if (!isCurrent(owner) || !guard?.isCurrent()) return;
      try {
        await guard.refresh();
        if (!guard.isCurrent() || !isCurrent(owner)) return;
        setFormDirty(false);
        setMatchingDirty(false);
        setConflicted(false);
        await queryClient.invalidateQueries({ queryKey: settingsKey, exact: true });
        if (!isCurrent(owner)) return;
        toast.success(t('roommates.alert.preferencesSaved'));
      } catch {
        if (isCurrent(owner)) toast.error(t('roommates.alert.preferencesFailed'));
      }
    },
    onError: () => {
      if (isCurrent(owner)) toast.error(t('roommates.alert.preferencesFailed'));
    },
  });

  // Local midnight today: a move-in date in the past is not a preference.
  const [today] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });

  const handleSave = () => {
    const query = queryClient.getQueryState(settingsKey);
    if (
      conflicted ||
      !isCurrent(owner) ||
      !settings ||
      query?.status !== 'success' ||
      query.fetchStatus !== 'idle' ||
      queryClient.getQueryData(settingsKey) !== settings
    )
      return;
    const variables = { preferences: toPreferences(form), enabled: roommateEnabled };
    if (!isProfileProjectionCurrent()) return;
    refreshOwners.current.set(variables, {
      refresh: refreshProfile,
      isCurrent: isProfileProjectionCurrent,
    });
    saveMutation.mutate(variables);
  };

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setFormDirty(true);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const secondary = { color: theme.colors.textSecondary };
  const paused = settingsQuery.fetchStatus === 'paused';
  const verifying = settingsQuery.fetchStatus !== 'idle';
  const unavailable = paused || settingsQuery.isError;
  const readOnly = saveMutation.isPending || verifying || settingsQuery.isError;

  const header = (
    <PageHeader
      title={t('roommates.preferencesPage.title')}
      titleAlign="center"
      leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
      onBack={router.canGoBack() ? router.back : undefined}
      backLabel={t('goBack')}
    />
  );

  if (!hasProfile) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView contentContainerStyle={styles.emptyWrap}>
          <EmptyState
            icon={RiUserLine}
            title={t('roommates.preferencesPage.personalProfileRequired')}
            description={t('roommates.preferencesPage.personalProfileDescription')}
            actionText={t('roommates.preferencesPage.switchToPersonal')}
            actionIcon={RiAccountCircleLine}
            onAction={() => router.push('/profile')}
          />
        </ScreenScrollView>
      </Screen>
    );
  }

  if (!settings) {
    const failed = unavailable;
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView contentContainerStyle={styles.emptyWrap}>
          <BloomText accessibilityLiveRegion="polite" accessibilityRole={failed ? 'alert' : 'text'}>
            {failed ? t('roommates.preferencesPage.refreshToSave') : t('common.loading')}
          </BloomText>
          {failed && (
            <Button
              size="md"
              onPress={() => {
                if (isCurrent(owner)) {
                  void settingsQuery.refetch();
                }
              }}
            >
              {t('common.retry')}
            </Button>
          )}
        </ScreenScrollView>
      </Screen>
    );
  }

  return (
    <Screen documentScroll header={header}>
      <ScreenScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleBlock}>
          <SectionEyebrow>{t('roommates.preferencesPage.eyebrow')}</SectionEyebrow>
          <H2 style={styles.title}>{t('roommates.preferences')}</H2>
          <BloomText style={[styles.subtitle, secondary]}>
            {t('roommates.preferencesPage.subtitle')}
          </BloomText>
        </View>

        <Card radius="radius-16" style={styles.card} appearance="outline">
          <View style={styles.toggleHeader}>
            <View style={styles.toggleHeaderText}>
              <BloomText style={styles.toggleTitle}>
                {t('roommates.preferencesPage.enableTitle')}
              </BloomText>
              <BloomText style={[styles.toggleDescription, secondary]}>
                {t('roommates.preferencesPage.enableDescription')}
              </BloomText>
            </View>
            <Switch
              disabled={readOnly}
              checked={roommateEnabled}
              onCheckedChange={(value) => {
                setMatchingDirty(true);
                setRoommateEnabled(value);
              }}
              accessibilityLabel={t('roommates.preferencesPage.enableTitle')}
            />
          </View>
        </Card>

        <Card radius="radius-16" style={styles.card} appearance="outline">
          <H3 style={styles.cardTitle}>{t('roommates.preferencesPage.budgetTimeline')}</H3>
          <RangeInputs
            disabled={readOnly}
            label={t('roommates.preferencesPage.monthlyBudget')}
            min={form.budgetMin}
            max={form.budgetMax}
            onMinChange={(text) => updateField('budgetMin', text)}
            onMaxChange={(text) => updateField('budgetMax', text)}
          />
          <Field label={t('roommates.preferencesPage.moveInDate')}>
            <DatePicker
              disabled={readOnly}
              value={parseDay(form.moveInDate)}
              onChange={(date) => updateField('moveInDate', date ? formatDay(date) : '')}
              minDate={today}
              locale={i18n.language}
              placeholder={t('roommates.match.flexible')}
              accessibilityLabel={t('roommates.preferencesPage.moveInDate')}
            />
          </Field>
          <ChipRow
            disabled={readOnly}
            label={t('roommates.preferencesPage.leaseLength')}
            value={form.leaseDuration}
            options={LEASE_OPTIONS}
            onChange={(v) => updateField('leaseDuration', v)}
          />
        </Card>

        <Card radius="radius-16" style={styles.card} appearance="outline">
          <H3 style={styles.cardTitle}>{t('roommates.preferencesPage.roommateSection')}</H3>
          <ChipRow
            disabled={readOnly}
            label={t('roommates.preferencesPage.preferredGender')}
            value={form.gender}
            options={GENDER_OPTIONS}
            onChange={(v) => updateField('gender', v)}
          />
          <RangeInputs
            disabled={readOnly}
            label={t('roommates.preferencesPage.ageRange')}
            min={form.ageMin}
            max={form.ageMax}
            onMinChange={(text) => updateField('ageMin', text)}
            onMaxChange={(text) => updateField('ageMax', text)}
          />
        </Card>

        <Card radius="radius-16" style={styles.card} appearance="outline">
          <H3 style={styles.cardTitle}>{t('roommates.preferencesPage.lifestyle')}</H3>
          <ChipRow
            disabled={readOnly}
            label={t('roommates.preferencesPage.smoking')}
            value={form.smoking}
            options={LIFESTYLE_OPTIONS}
            onChange={(v) => updateField('smoking', v)}
          />
          <ChipRow
            disabled={readOnly}
            label={t('roommates.preferencesPage.pets')}
            value={form.pets}
            options={LIFESTYLE_OPTIONS}
            onChange={(v) => updateField('pets', v)}
          />
          <ChipRow
            disabled={readOnly}
            label={t('roommates.preferencesPage.partying')}
            value={form.partying}
            options={LIFESTYLE_OPTIONS}
            onChange={(v) => updateField('partying', v)}
          />
          <ChipRow
            disabled={readOnly}
            label={t('roommates.preferencesPage.cleanliness')}
            value={form.cleanliness}
            options={CLEANLINESS_OPTIONS}
            onChange={(v) => updateField('cleanliness', v)}
          />
          <ChipRow
            disabled={readOnly}
            label={t('roommates.preferencesPage.schedule')}
            value={form.schedule}
            options={SCHEDULE_OPTIONS}
            onChange={(v) => updateField('schedule', v)}
          />
        </Card>

        {(verifying || settingsQuery.isError) && (
          <BloomText accessibilityRole="alert" accessibilityLiveRegion="polite">
            {t('roommates.preferencesPage.refreshToSave')}
          </BloomText>
        )}
        {unavailable && (
          <Button
            size="md"
            onPress={() => {
              if (isCurrent(owner)) void settingsQuery.refetch();
            }}
          >
            {t('common.retry')}
          </Button>
        )}
        {conflicted && (
          <>
            <BloomText accessibilityRole="alert">
              {t('roommates.preferencesPage.remoteConflict')}
            </BloomText>
            <Button
              size="md"
              disabled={readOnly}
              onPress={() => {
                if (!isCurrent(owner) || !settings) return;
                setForm(settings.preferences ? seedForm(settings.preferences) : DEFAULT_FORM);
                setRoommateEnabled(settings.status.hasRoommateMatching);
                setFormDirty(false);
                setMatchingDirty(false);
                setConflicted(false);
              }}
            >
              {t('roommates.preferencesPage.discardAndReload')}
            </Button>
          </>
        )}
        <Button
          size="lg"
          onPress={handleSave}
          accessibilityHint={
            verifying || settingsQuery.isError
              ? t('roommates.preferencesPage.refreshToSave')
              : undefined
          }
          loading={saveMutation.isPending}
          disabled={readOnly || conflicted}
          style={styles.saveButton}
          tone="accent"
          appearance="solid"
        >
          {saveMutation.isPending
            ? t('roommates.preferencesPage.saving')
            : t('roommates.preferencesPage.save')}
        </Button>
      </ScreenScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  emptyWrap: {
    flexGrow: 1,
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
  },
  card: {
    padding: spacing.lg,
    gap: spacing.md,
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
  },
  toggleDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  inlineInputs: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  inlineInput: {
    flex: 1,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  saveButton: {
    alignSelf: 'stretch',
  },
});
