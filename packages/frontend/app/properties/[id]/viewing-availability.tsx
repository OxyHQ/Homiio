/**
 * "When can I show this place?" — the owner's side of #518 §7.5.
 *
 * The half of real availability that nothing in Homiio had: a landlord could
 * receive viewing requests but had no way to say when they were possible. The
 * booking screen filled that silence with thirteen invented time slots; this
 * screen is what replaces the invention with a statement.
 *
 * ## A weekly recurrence, edited as a whole
 *
 * Rows of "day, from, to, how long, how". Saving REPLACES the schedule rather
 * than patching it, matching `PUT /api/properties/:id/viewing-windows` — a
 * calendar is edited as a whole, and half an edit is a schedule the owner never
 * chose, offering times they cannot keep.
 *
 * ## The timezone is on this screen and not somewhere else
 *
 * "17:00" is not a time until the zone is known, so the two are one fact and
 * one form. The screen states which zone is in force and where it came from,
 * because `fallback` — nobody has said — is a real answer the owner is the only
 * person who can fix.
 */

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@oxy.so/bloom/button';
import { Admonition } from '@oxy.so/bloom/admonition';
import { Card } from '@oxy.so/bloom/card';
import { Chip } from '@oxy.so/bloom/chip';
import { Field } from '@oxy.so/bloom/field';
import { RiAddLine, RiCalendarLine, RiDeleteBinLine } from '@oxy.so/bloom/icons';
import { Loading } from '@oxy.so/bloom/loading';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import {
  DEFAULT_VIEWING_DURATION_MINUTES,
  MAX_VIEWING_DURATION_MINUTES,
  MIN_VIEWING_DURATION_MINUTES,
  VIEWING_MODALITIES,
  VIEWING_WINDOWS_MAX,
  deviceTimeZone,
  formatMinuteOfDay,
  isSupportedTimeZone,
  parseMinuteOfDay,
  type ViewingModality,
  type ViewingWindowInput,
} from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { viewingService } from '@/services/viewingService';
import { spacing } from '@/constants/styles';

/** One row of the form. Times are strings while they are being typed. */
interface WindowDraft {
  key: string;
  weekday: number;
  from: string;
  to: string;
  slotMinutes: string;
  modality: ViewingModality;
}

/** `0` = Sunday, matching what the table stores and `extract(dow)` returns. */
const WEEKDAY_KEYS = [
  'viewings.schedule.weekday.sun',
  'viewings.schedule.weekday.mon',
  'viewings.schedule.weekday.tue',
  'viewings.schedule.weekday.wed',
  'viewings.schedule.weekday.thu',
  'viewings.schedule.weekday.fri',
  'viewings.schedule.weekday.sat',
];

let draftCounter = 0;
function newDraft(weekday = 2): WindowDraft {
  draftCounter += 1;
  return {
    key: `draft-${draftCounter}`,
    weekday,
    from: '17:00',
    to: '19:00',
    slotMinutes: String(DEFAULT_VIEWING_DURATION_MINUTES),
    modality: 'in_person',
  };
}

export default function ViewingAvailabilityPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams();
  const propertyId = Array.isArray(id) ? id[0] : id;

  /**
   * The form is an OVERRIDE of what the server holds, not a copy of it.
   *
   * `null` means "nothing typed yet", and the rows then come straight from the
   * query. Copying the server's answer into state in an effect would be a
   * synchronous setState in an effect — a cascading render — and, worse, would
   * have to guess when NOT to re-copy: a refetch landing while the owner is
   * mid-edit would throw away what they were typing.
   */
  const [draftsOverride, setDraftsOverride] = useState<WindowDraft[] | null>(null);
  const [timeZoneOverride, setTimeZoneOverride] = useState<string | null>(null);

  const scheduleQuery = useQuery({
    queryKey: ['viewings', 'schedule', propertyId],
    queryFn: async () => (await viewingService.getSchedule(propertyId as string)).data,
    enabled: Boolean(propertyId),
  });

  const savedDrafts = useMemo<WindowDraft[]>(
    () =>
      (scheduleQuery.data?.windows ?? []).map((window, index) => ({
        key: `saved-${index}`,
        weekday: window.weekday,
        from: formatMinuteOfDay(window.startMinute),
        to: formatMinuteOfDay(window.endMinute),
        slotMinutes: String(window.slotMinutes),
        modality: window.modality,
      })),
    [scheduleQuery.data],
  );

  const drafts = draftsOverride ?? savedDrafts;
  const timeZone = timeZoneOverride ?? scheduleQuery.data?.timeZone ?? '';
  const setDrafts = (next: WindowDraft[] | ((rows: WindowDraft[]) => WindowDraft[])) =>
    setDraftsOverride((current) =>
      typeof next === 'function' ? next(current ?? savedDrafts) : next,
    );
  const setTimeZone = setTimeZoneOverride;

  const save = useMutation({
    mutationFn: async (payload: { windows: ViewingWindowInput[]; timeZone: string }) =>
      viewingService.putSchedule(propertyId as string, payload),
    onSuccess: async () => {
      toast.success(t('viewings.schedule.saved'));
      await queryClient.invalidateQueries({ queryKey: ['viewings', 'schedule', propertyId] });
      await queryClient.invalidateQueries({ queryKey: ['viewings', 'availability', propertyId] });
      router.back();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t('viewings.error.generic'));
    },
  });

  /**
   * The first thing wrong with the form, or `null`.
   *
   * Every rule here is also a CHECK constraint and a server-side check. The
   * duplication is on purpose and the database is the authority: this exists so
   * the owner is told WHICH row is wrong and why, rather than being handed a
   * 23514 they cannot act on.
   */
  const firstProblem = (): string | null => {
    if (!isSupportedTimeZone(timeZone)) return t('viewings.schedule.invalidTimezone');
    if (drafts.length > VIEWING_WINDOWS_MAX) {
      return t('viewings.schedule.tooManyWindows', { max: VIEWING_WINDOWS_MAX });
    }
    for (let index = 0; index < drafts.length; index += 1) {
      const draft = drafts[index];
      const from = parseMinuteOfDay(draft.from);
      const to = draft.to === '24:00' ? 1440 : parseMinuteOfDay(draft.to);
      const length = Number(draft.slotMinutes);
      if (from === null || to === null) {
        return t('viewings.schedule.rowTimeFormat', { row: index + 1 });
      }
      if (to <= from) return t('viewings.schedule.rowOrder', { row: index + 1 });
      if (
        !Number.isInteger(length) ||
        length < MIN_VIEWING_DURATION_MINUTES ||
        length > MAX_VIEWING_DURATION_MINUTES
      ) {
        return t('viewings.schedule.rowLength', {
          row: index + 1,
          min: MIN_VIEWING_DURATION_MINUTES,
          max: MAX_VIEWING_DURATION_MINUTES,
        });
      }
      // The silent one: a window shorter than its own slot offers nothing, and
      // the screen would then say the owner published no times.
      if (to - from < length) return t('viewings.schedule.rowTooShort', { row: index + 1 });
    }
    return null;
  };

  const problem = firstProblem();

  const submit = () => {
    if (problem) {
      toast.error(problem);
      return;
    }
    save.mutate({
      timeZone,
      windows: drafts.map((draft) => ({
        weekday: draft.weekday,
        startMinute: parseMinuteOfDay(draft.from) as number,
        endMinute: draft.to === '24:00' ? 1440 : (parseMinuteOfDay(draft.to) as number),
        slotMinutes: Number(draft.slotMinutes),
        modality: draft.modality,
      })),
    });
  };

  const patch = (key: string, changes: Partial<WindowDraft>) =>
    setDrafts((rows) => rows.map((row) => (row.key === key ? { ...row, ...changes } : row)));

  if (scheduleQuery.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <Header options={{ showBackButton: true, title: t('viewings.schedule.title') }} />
        <View style={styles.centered}>
          <Loading variant="spinner" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (scheduleQuery.isError) {
    // A listing somebody else owns answers 404 here — ownership is enforced in
    // the repository query, so a stranger cannot tell it apart from a listing
    // that does not exist. That is the intended outcome, not an error to
    // explain away.
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <Header options={{ showBackButton: true, title: t('viewings.schedule.title') }} />
        <ErrorState
          title={t('viewings.schedule.notYours')}
          description={t('viewings.schedule.notYoursDescription')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Header options={{ showBackButton: true, title: t('viewings.schedule.title') }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Admonition type="info">{t('viewings.schedule.explainer')}</Admonition>

        {scheduleQuery.data?.timeZoneSource === 'fallback' ? (
          <Admonition type="warning">{t('viewings.schedule.timezoneUnset')}</Admonition>
        ) : null}

        <Field label={t('viewings.schedule.timezone')}>
          <TextFieldInput
            label={t('viewings.schedule.timezone')}
            value={timeZone}
            onChangeText={setTimeZone}
            placeholder={deviceTimeZone()}
            autoCapitalize="none"
          />
        </Field>

        {drafts.length === 0 ? (
          <EmptyState
            icon={RiCalendarLine}
            title={t('viewings.schedule.emptyTitle')}
            description={t('viewings.schedule.emptyDescription')}
          />
        ) : null}

        {drafts.map((draft, index) => (
          <Card key={draft.key} variant="outlined" radius="radius-16" className="gap-3 p-4">
            <Text style={styles.rowTitle}>
              {t('viewings.schedule.rowTitle', { row: index + 1 })}
            </Text>

            <View style={styles.chipRow} accessibilityRole="radiogroup">
              {WEEKDAY_KEYS.map((labelKey, weekday) => (
                <Chip
                  key={labelKey}
                  selected={draft.weekday === weekday}
                  onPress={() => patch(draft.key, { weekday })}
                  accessibilityLabel={t(labelKey)}
                >
                  {t(labelKey)}
                </Chip>
              ))}
            </View>

            <View style={styles.timeRow}>
              <Field label={t('viewings.schedule.from')}>
                <TextFieldInput
                  label={t('viewings.schedule.from')}
                  value={draft.from}
                  onChangeText={(value) => patch(draft.key, { from: value })}
                  placeholder="17:00"
                  maxLength={5}
                />
              </Field>
              <Field label={t('viewings.schedule.to')}>
                <TextFieldInput
                  label={t('viewings.schedule.to')}
                  value={draft.to}
                  onChangeText={(value) => patch(draft.key, { to: value })}
                  placeholder="19:00"
                  maxLength={5}
                />
              </Field>
              <Field label={t('viewings.schedule.slotMinutes')}>
                <TextFieldInput
                  label={t('viewings.schedule.slotMinutes')}
                  value={draft.slotMinutes}
                  onChangeText={(value) => patch(draft.key, { slotMinutes: value })}
                  placeholder={String(DEFAULT_VIEWING_DURATION_MINUTES)}
                  keyboardType="number-pad"
                  maxLength={3}
                />
              </Field>
            </View>

            <View style={styles.chipRow} accessibilityRole="radiogroup">
              {VIEWING_MODALITIES.map((value) => (
                <Chip
                  key={value}
                  selected={draft.modality === value}
                  onPress={() => patch(draft.key, { modality: value })}
                  accessibilityLabel={t(`viewings.modality.${value}`)}
                >
                  {t(`viewings.modality.${value}`)}
                </Chip>
              ))}
            </View>

            <Button
              variant="ghost"
              leadingIcon={RiDeleteBinLine}
              onPress={() => setDrafts((rows) => rows.filter((row) => row.key !== draft.key))}
            >
              {t('viewings.schedule.removeWindow')}
            </Button>
          </Card>
        ))}

        <Button
          variant="secondary"
          leadingIcon={RiAddLine}
          disabled={drafts.length >= VIEWING_WINDOWS_MAX}
          onPress={() => setDrafts((rows) => [...rows, newDraft()])}
        >
          {t('viewings.schedule.addWindow')}
        </Button>

        {problem ? <Admonition type="warning">{problem}</Admonition> : null}

        <Button
          variant="primary"
          size="large"
          onPress={submit}
          disabled={save.isPending}
          loading={save.isPending}
        >
          {t('viewings.schedule.save')}
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: 880,
    alignSelf: 'center',
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  rowTitle: { fontSize: 16, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  timeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
