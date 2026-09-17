/**
 * Viewings list — upcoming property visits the user has scheduled.
 *
 * Stream Q polish:
 *   - Bloom Button for modify/cancel, Bloom Chip filter row, Bloom Skeleton
 *     while loading, Bloom Typography throughout.
 *   - Bloom outlined Card per viewing, status as a Chip data hue.
 *   - Shared EmptyState / ErrorState components.
 *   - Confirm cancel via Bloom `confirm()`.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { deviceTimeZone, formatDate } from '@homiio/shared-types';
import { useFormatting } from '@/utils/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@oxy.so/bloom/toast';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { Chip, type ChipHue } from '@oxy.so/bloom/chip';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { Text as BloomText, H2, H3 } from '@oxy.so/bloom/typography';
import { useOxy, openAccountDialog } from '@oxy.so/services';
import { Header } from '@/components/Header';
import { confirm } from '@oxy.so/bloom/surfaces';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { viewingService, ViewingRequest } from '@/services/viewingService';
import { ApiError } from '@/utils/api';
import { spacing } from '@/constants/styles';
import { colors } from '@/styles/colors';
import { RiAlertLine, RiCalendarLine, RiLoginBoxLine } from '@oxy.so/bloom/icons';

type ViewingStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

/** Viewing status → Bloom Chip data hue + i18n label key. */
const STATUS_TOKENS: Record<ViewingStatus, { hue: ChipHue; i18nKey: string }> = {
  pending: { hue: 'yellow', i18nKey: 'viewings.status.pending' },
  approved: { hue: 'lime', i18nKey: 'viewings.status.approved' },
  declined: { hue: 'rose', i18nKey: 'viewings.status.declined' },
  cancelled: { hue: 'neutral', i18nKey: 'viewings.status.cancelled' },
};

const FILTERS: { id: 'all' | ViewingStatus; i18nKey: string }[] = [
  { id: 'all', i18nKey: 'common.all' },
  { id: 'pending', i18nKey: 'viewings.status.pending' },
  { id: 'approved', i18nKey: 'viewings.status.approved' },
  { id: 'declined', i18nKey: 'viewings.status.declined' },
  { id: 'cancelled', i18nKey: 'viewings.status.cancelled' },
];

/**
 * A viewing's `scheduledAt` is an INSTANT, so which day and clock time it lands
 * on depends on the zone it is read in. It renders in the device's zone, named
 * explicitly rather than left to `toLocaleDateString()`'s implicit one, and the
 * zone abbreviation is shown so a viewing that falls on a different day for a
 * traveller says so instead of quietly moving.
 *
 * It used to force `en-US` for the time and the runtime default for the date, so
 * the two halves of one string could come from two different locales.
 */
const formatDateTime = (scheduledAt: string, locale: string, timeZone: string): string =>
  formatDate(scheduledAt, locale, timeZone, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }) || scheduledAt;

const ViewingsSkeleton: React.FC = () => (
  <View style={styles.listWrap}>
    {Array.from({ length: 3 }).map((_, idx) => (
      <Card key={idx} variant="outlined" radius="radius-16" className="gap-2 p-4">
        <View style={styles.skeletonHeader}>
          <Skeleton.Text style={{ width: 160, lineHeight: 18 }} />
          <Skeleton.Pill size={20} />
        </View>
        <Skeleton.Text style={{ width: 220, lineHeight: 14 }} />
        <Skeleton.Text style={{ width: 180, lineHeight: 14 }} />
      </Card>
    ))}
  </View>
);

interface ViewingCardProps {
  viewing: ViewingRequest;
  onCancel: () => void;
  onModify: () => void;
  cancelling: boolean;
}

const ViewingCard: React.FC<ViewingCardProps> = ({
  viewing,
  onCancel,
  onModify,
  cancelling,
}) => {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const status = viewing.status as ViewingStatus;
  const token = STATUS_TOKENS[status] ?? STATUS_TOKENS.pending;
  const isActionable = status === 'pending' || status === 'approved';

  return (
    <Card variant="outlined" radius="radius-16" className="gap-2 p-4">
      <View style={styles.headerRow}>
        <H3 style={styles.cardTitle}>{formatDateTime(viewing.scheduledAt, locale, deviceTimeZone())}</H3>
        <Chip size="small" hue={token.hue}>
          {t(token.i18nKey)}
        </Chip>
      </View>
      {viewing.propertyTitle ? (
        <BloomText className="text-sm text-foreground">{viewing.propertyTitle}</BloomText>
      ) : null}
      {viewing.message ? (
        <BloomText className="text-sm italic text-muted-foreground">{viewing.message}</BloomText>
      ) : null}

      {isActionable ? (
        <View style={styles.actionRow}>
          {status === 'pending' ? (
            <Button
              variant="primary"
              size="medium"
              onPress={onModify}
              style={styles.actionButton}
            >
              {t('viewings.actions.modify')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="medium"
            onPress={onCancel}
            loading={cancelling}
            disabled={cancelling}
            style={styles.actionButton}
          >
            {t('viewings.actions.cancel')}
          </Button>
        </View>
      ) : null}
    </Card>
  );
};

export default function ViewingsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();
  const isAuthed = Boolean(oxyServices && activeSessionId);

  const [filter, setFilter] = useState<'all' | ViewingStatus>('all');
  const [cancelTarget, setCancelTarget] = useState<ViewingRequest | null>(null);

  const viewingsQuery = useQuery({
    queryKey: ['viewings', 'me'],
    queryFn: async () => {
      const res = await viewingService.listMyViewingRequests({
        page: 1,
        limit: 50,
      });
      return Array.isArray(res?.data) ? (res.data as ViewingRequest[]) : [];
    },
    enabled: isAuthed,
  });

  const extractErrorMessage = (error: unknown): string => {
    if (error instanceof ApiError) {
      const response =
        error.response && typeof error.response === 'object'
          ? (error.response as { error?: { code?: string }; code?: string })
          : undefined;
      const errorCode = response?.error?.code ?? response?.code;
      switch (errorCode) {
        case 'VIEWING_NOT_FOUND':
          return t('viewings.error.notFound');
        case 'CANNOT_CANCEL':
          return t('viewings.error.cannotCancel');
        case 'AUTHENTICATION_REQUIRED':
          return t('viewings.error.authRequired');
        default:
          return t('viewings.error.generic');
      }
    }
    return t('viewings.error.generic');
  };

  const cancelMutation = useMutation({
    mutationFn: async (viewingId: string) => viewingService.cancel(viewingId),
    onSuccess: () => {
      toast.success(t('viewings.success.cancelled'));
      queryClient.invalidateQueries({ queryKey: ['viewings', 'me'] });
      setCancelTarget(null);
    },
    onError: (error: unknown) => {
      toast.error(extractErrorMessage(error));
    },
  });

  const handleCancel = async (viewing: ViewingRequest) => {
    const ok = await confirm({
      title: t('viewings.actions.cancel'),
      description: t('viewings.cancel.confirmMessage'),
      confirmLabel: t('viewings.actions.cancel'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    setCancelTarget(viewing);
    cancelMutation.mutate(viewing.id);
  };

  const handleModify = (viewing: ViewingRequest) => {
    router.push({
      pathname: `/properties/${viewing.propertyId}/book-viewing`,
      params: { modifyViewingId: viewing.id },
    });
  };

  const filteredViewings = useMemo(() => {
    const list = viewingsQuery.data ?? [];
    if (filter === 'all') return list;
    return list.filter((v) => v.status === filter);
  }, [filter, viewingsQuery.data]);

  if (!isAuthed) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: t('viewings.title'),
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.emptyWrap}>
            <EmptyState
              icon={RiCalendarLine}
              title="Sign in to see your viewings"
              description="Schedule property visits and track host responses."
              actionText={t('common.signIn')}
              actionIcon={RiLoginBoxLine}
              onAction={() => openAccountDialog()}
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
          showBackButton: true,
          title: t('viewings.title'),
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.titleBlock}>
            <SectionEyebrow>Upcoming visits</SectionEyebrow>
            <H2 style={styles.title}>Your viewings</H2>
            <BloomText style={styles.subtitle}>
              Track every visit you have requested and reschedule or cancel
              with one tap.
            </BloomText>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {FILTERS.map((entry) => {
              return (
                <Chip
                  key={entry.id}
                  onPress={() => setFilter(entry.id)}
                  variant="subtle"
                  selected={filter === entry.id}
                >
                  {t(entry.i18nKey)}
                </Chip>
              );
            })}
          </ScrollView>

          {viewingsQuery.isLoading ? <ViewingsSkeleton /> : null}

          {viewingsQuery.isError ? (
            <ErrorState
              icon={RiAlertLine}
              title={t('viewings.error.generic')}
              description={viewingsQuery.error?.message ?? t('common.tryAgain')}
              onRetry={() => viewingsQuery.refetch()}
            />
          ) : null}

          {!viewingsQuery.isLoading &&
          !viewingsQuery.isError &&
          filteredViewings.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon={RiCalendarLine}
                title={t('viewings.empty.title')}
                description={t('viewings.empty.description')}
              />
            </View>
          ) : null}

          {filteredViewings.length > 0 ? (
            <View style={styles.listWrap}>
              {filteredViewings.map((viewing) => (
                <ViewingCard
                  key={viewing.id}
                  viewing={viewing}
                  cancelling={
                    cancelMutation.isPending &&
                    cancelTarget?.id === viewing.id
                  }
                  onCancel={() => void handleCancel(viewing)}
                  onModify={() => handleModify(viewing)}
                />
              ))}
            </View>
          ) : null}
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
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  listWrap: {
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    letterSpacing: -0.2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
  skeletonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
