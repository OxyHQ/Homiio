/**
 * One repair request: its card, its thread and every action the caller may
 * take (#518 §7.1, #519 §7.1).
 *
 * ## Only the server's own list of actions is offered
 *
 * `request.availableTransitions` is computed server-side from the caller's role
 * against the same transition table the repository validates with, so a button
 * appears exactly where pressing it can succeed.
 *
 * This screen is also where `scheduled` is offered, because it is the one
 * transition that needs a DATE and the only surface that can ask for one — the
 * inline row in My home deliberately filters it out rather than drawing a
 * button that would 400.
 *
 * ## Photos are not here
 *
 * Both epics ask for them; both also forbid putting a tenancy's evidence
 * through the public image endpoint, which is the only upload path Homiio has.
 * No affordance is drawn for something that cannot work. See
 * `docs/housing-parity.md`.
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@oxy.so/bloom/button';
import { Field } from '@oxy.so/bloom/field';
import { MaintenanceRequestCard } from '@oxy.so/bloom/tenancy';
import { Textarea } from '@oxy.so/bloom/textarea';
import { toast } from '@oxy.so/bloom/toast';
import { P } from '@oxy.so/bloom/typography';
import { MAINTENANCE_COMMENT_MAX, type MaintenanceStatus } from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import {
  maintenanceCardProps,
  maintenanceStatusKey,
} from '@/components/tenancy/maintenanceTenancy';
import {
  useCommentOnRepair,
  useMaintenanceRequest,
  useTransitionRepair,
} from '@/hooks/useMaintenanceQueries';
import { isTransitionConflict } from '@/services/maintenanceService';
import { formatLocalized } from '@/utils/dateLocale';
import { spacing } from '@/constants/styles';

/** The verb for each destination status. Verbs, not the status nouns. */
const ACTION_KEY: Record<MaintenanceStatus, string> = {
  open: 'maintenance.action.reopen',
  acknowledged: 'maintenance.action.acknowledge',
  scheduled: 'maintenance.action.schedule',
  resolved: 'maintenance.action.markResolved',
  closed: 'maintenance.action.close',
  declined: 'maintenance.action.decline',
};

/**
 * How far ahead a repair is scheduled when the landlord presses "Schedule".
 *
 * The date picker belongs on this screen eventually; until it is here, the
 * action commits a concrete, visible day rather than nothing — and the request
 * can be rescheduled by moving it again. A version that sent no date at all
 * would 400, which is the button-that-does-nothing both epics forbid.
 */
const DEFAULT_SCHEDULE_DAYS = 7;

export default function MaintenanceRequestScreen(): React.ReactElement {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: request, isLoading, error, refetch } = useMaintenanceRequest(id);
  const transition = useTransitionRepair();
  const comment = useCommentOnRepair();
  const [draft, setDraft] = useState('');

  const act = useCallback(
    (status: MaintenanceStatus) => {
      if (!id) return;
      const scheduledFor =
        status === 'scheduled'
          ? new Date(Date.now() + DEFAULT_SCHEDULE_DAYS * 24 * 60 * 60 * 1000).toISOString()
          : undefined;
      transition.mutate(
        { id, status, ...(scheduledFor ? { scheduledFor } : {}) },
        {
          onError: (mutationError) => {
            if (isTransitionConflict(mutationError)) {
              toast.info(t('maintenance.errors.conflict'));
              return;
            }
            toast.error(t('maintenance.errors.transitionFailed'));
          },
        },
      );
    },
    [id, transition, t],
  );

  const send = useCallback(() => {
    const body = draft.trim();
    if (!id || body.length === 0) return;
    comment.mutate(
      { id, body },
      {
        onSuccess: () => setDraft(''),
        onError: () => toast.error(t('maintenance.errors.commentFailed')),
      },
    );
  }, [comment, draft, id, t]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.screen}>
        <Header options={{ title: t('maintenance.section.title') }} />
        <ListSkeleton rows={3} />
      </SafeAreaView>
    );
  }

  if (error || !request) {
    return (
      <SafeAreaView style={styles.screen}>
        <Header options={{ title: t('maintenance.section.title') }} />
        <ErrorState
          title={t('maintenance.errors.loadFailed')}
          onRetry={() => void refetch()}
          retryLabel={t('common.retry')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <Header options={{ title: request.title }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <MaintenanceRequestCard
          {...maintenanceCardProps(request, { t })}
          actions={
            <View style={styles.actions}>
              {(request.availableTransitions ?? []).map((status) => (
                <Button
                  key={status}
                  variant="secondary"
                  size="small"
                  disabled={transition.isPending}
                  onPress={() => act(status)}
                  accessibilityLabel={t(ACTION_KEY[status])}
                >
                  {t(ACTION_KEY[status])}
                </Button>
              ))}
            </View>
          }
        />

        <View style={styles.thread}>
          {(request.comments ?? []).length === 0 ? (
            <P style={styles.muted}>{t('maintenance.comments.empty')}</P>
          ) : (
            (request.comments ?? []).map((entry) => (
              <View key={entry.id} style={styles.comment}>
                <P style={styles.commentMeta}>
                  {t(`maintenance.role.${entry.role}`)} ·{' '}
                  {formatLocalized(new Date(entry.createdAt), 'd MMM, HH:mm')}
                </P>
                <P>{entry.body}</P>
              </View>
            ))
          )}
        </View>

        <Field label={t('maintenance.comments.add')}>
          <Textarea
            value={draft}
            onChangeText={setDraft}
            maxLength={MAINTENANCE_COMMENT_MAX}
            placeholder={t('maintenance.comments.placeholder')}
          />
        </Field>
        <View style={styles.actions}>
          <Button
            variant="primary"
            size="medium"
            disabled={draft.trim().length === 0 || comment.isPending}
            loading={comment.isPending}
            onPress={send}
            accessibilityLabel={t('maintenance.comments.sendAccessible')}
          >
            {t('maintenance.comments.send')}
          </Button>
        </View>

        <View style={styles.history}>
          <P style={styles.muted}>{t('maintenance.history.title')}</P>
          {(request.events ?? []).map((event) => (
            <P key={event.id} style={styles.commentMeta}>
              {formatLocalized(new Date(event.createdAt), 'd MMM, HH:mm')} ·{' '}
              {t(`maintenance.role.${event.role}`)} · {t(maintenanceStatusKey(event.to))}
            </P>
          ))}
        </View>

        <View style={styles.actions}>
          <Button
            variant="ghost"
            size="small"
            onPress={() => router.replace('/my-home')}
            accessibilityLabel={t('maintenance.report.goToMyHome')}
          >
            {t('maintenance.report.goToMyHome')}
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing['3xl'] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thread: { gap: spacing.md },
  comment: { gap: spacing.xs },
  commentMeta: { fontSize: 12, opacity: 0.7 },
  muted: { fontSize: 13, opacity: 0.7 },
  history: { gap: spacing.xs },
});
