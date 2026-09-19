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
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
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
  useAttachRepairPhoto,
  useCommentOnRepair,
  useMaintenanceRequest,
  useTransitionRepair,
} from '@/hooks/useMaintenanceQueries';
import { isTransitionConflict } from '@/services/maintenanceService';
import { openPrivateDocument } from '@/utils/privateDocument';
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

/**
 * How many photos one request may hold — the server's ceiling, restated.
 *
 * Restated rather than fetched, because the only thing it drives here is
 * whether the "add" button is drawn, and the SERVER refuses past it either way
 * (409). A screen out of step with it offers a button that fails, which is the
 * lesser of the two ways to be wrong; a screen that hid the ceiling would make
 * a refusal arrive with nothing on the page to explain it.
 */
const MAINTENANCE_PHOTOS_MAX = 6;

export default function MaintenanceRequestScreen(): React.ReactElement {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: request, isLoading, error, refetch } = useMaintenanceRequest(id);
  const transition = useTransitionRepair();
  const comment = useCommentOnRepair();
  const attach = useAttachRepairPhoto();
  const [draft, setDraft] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const attachments = request?.attachments ?? [];

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

  /**
   * Pick one photo and send it.
   *
   * The permission is requested at the moment somebody presses the button, not
   * on mount — the same rule the location surfaces follow, and for the same
   * reason: a prompt nobody asked for is a barrier, and this screen is useful
   * without ever touching the library.
   */
  const addPhoto = useCallback(async () => {
    if (!id) return;
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        toast.error(t('maintenance.photos.permission'));
        return;
      }
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    const asset = picked.assets[0];

    attach.mutate(
      {
        id,
        photo: {
          uri: asset.uri,
          filename: asset.fileName ?? 'photo.jpg',
          ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
        },
      },
      { onError: () => toast.error(t('maintenance.photos.uploadFailed')) },
    );
  }, [attach, id, t]);

  /**
   * Open one photo.
   *
   * Through {@link openPrivateDocument}, because there is no link: the bytes
   * come from a handler that checks who is asking, so neither `window.open` nor
   * `Linking.openURL` can reach them.
   */
  const view = useCallback(
    (attachmentId: string, downloadPath: string) => {
      setOpeningId(attachmentId);
      openPrivateDocument(downloadPath)
        .catch(() => toast.error(t('maintenance.photos.openFailed')))
        .finally(() => setOpeningId(null));
    },
    [t],
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

        {/* Photos, before the thread: what is broken is the first thing
            somebody opening a repair wants to see. */}
        <View style={styles.photos}>
          <P style={styles.muted}>
            {t('maintenance.photos.title', { count: attachments.length })}
          </P>
          {attachments.length === 0 ? (
            <P style={styles.muted}>{t('maintenance.photos.empty')}</P>
          ) : (
            attachments.map((attachment) => (
              <Button
                key={attachment.id}
                variant="secondary"
                size="small"
                disabled={openingId !== null}
                loading={openingId === attachment.id}
                onPress={() => view(attachment.id, attachment.downloadPath)}
                accessibilityLabel={t('maintenance.photos.openAccessible', {
                  role: t(`maintenance.role.${attachment.role}`),
                  date: formatLocalized(new Date(attachment.createdAt), 'd MMM, HH:mm'),
                })}
              >
                {t('maintenance.photos.row', {
                  role: t(`maintenance.role.${attachment.role}`),
                  date: formatLocalized(new Date(attachment.createdAt), 'd MMM, HH:mm'),
                })}
              </Button>
            ))
          )}
          {attachments.length < MAINTENANCE_PHOTOS_MAX ? (
            <Button
              variant="secondary"
              size="small"
              disabled={attach.isPending}
              loading={attach.isPending}
              onPress={addPhoto}
              accessibilityLabel={t('maintenance.photos.addAccessible')}
            >
              {t('maintenance.photos.add')}
            </Button>
          ) : (
            // Said rather than silently hidden: a button that vanishes reads as
            // a bug, and the ceiling is a real rule the server enforces.
            <P style={styles.muted}>
              {t('maintenance.photos.full', { count: MAINTENANCE_PHOTOS_MAX })}
            </P>
          )}
        </View>

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
  photos: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  history: { gap: spacing.xs },
});
