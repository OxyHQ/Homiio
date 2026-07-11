/**
 * Viewings list — upcoming property visits the user has scheduled.
 *
 * Stream Q polish:
 *   - Bloom Button for modify/cancel, Bloom Chip filter row, Bloom Skeleton
 *     while loading, Bloom Typography throughout.
 *   - Flat cards with radius.lg + hairline borders.
 *   - Shared EmptyState / ErrorState components.
 *   - Confirm cancel via ConfirmDialog (Bloom Modal-based).
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/sonner';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import { Chip } from '@oxyhq/bloom/chip';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { Text as BloomText, H2, H3 } from '@oxyhq/bloom/typography';
import { useOxy, showSignInModal } from '@oxyhq/services';
import { Header } from '@/components/Header';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { viewingService, ViewingRequest } from '@/services/viewingService';
import { ApiError } from '@/utils/api';
import { radius, spacing } from '@/constants/styles';
import { colors } from '@/styles/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type ViewingStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

interface StatusToken {
  bg: string;
  fg: string;
  label: string;
  icon: IoniconName;
}

const STATUS_TOKENS: Record<ViewingStatus, StatusToken> = {
  pending: {
    bg: colors.warningSubtle,
    fg: colors.warning,
    label: 'Pending',
    icon: 'time-outline',
  },
  approved: {
    bg: colors.successSubtle,
    fg: colors.success,
    label: 'Approved',
    icon: 'checkmark-circle-outline',
  },
  declined: {
    bg: colors.dangerSubtle,
    fg: colors.danger,
    label: 'Declined',
    icon: 'close-circle-outline',
  },
  cancelled: {
    bg: colors.mutedSubtle,
    fg: colors.muted,
    label: 'Cancelled',
    icon: 'remove-circle-outline',
  },
};

const FILTERS: { id: 'all' | ViewingStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'declined', label: 'Declined' },
  { id: 'cancelled', label: 'Cancelled' },
];

const formatDateTime = (scheduledAt: string) => {
  try {
    const date = new Date(scheduledAt);
    const dateFormatted = date.toLocaleDateString();
    const timeFormatted = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${dateFormatted} at ${timeFormatted}`;
  } catch {
    return scheduledAt;
  }
};

const ViewingsSkeleton: React.FC = () => (
  <View style={styles.listWrap}>
    {Array.from({ length: 3 }).map((_, idx) => (
      <View key={idx} style={styles.skeletonCard}>
        <View style={styles.skeletonHeader}>
          <Skeleton.Text style={{ width: 160, lineHeight: 18 }} />
          <Skeleton.Pill size={20} />
        </View>
        <Skeleton.Text style={{ width: 220, lineHeight: 14 }} />
        <Skeleton.Text style={{ width: 180, lineHeight: 14 }} />
      </View>
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
  const status = viewing.status as ViewingStatus;
  const token = STATUS_TOKENS[status] ?? STATUS_TOKENS.pending;
  const isActionable = status === 'pending' || status === 'approved';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <H3 style={styles.cardTitle}>{formatDateTime(viewing.scheduledAt)}</H3>
        <View style={[styles.statusBadge, { backgroundColor: token.bg }]}>
          <Ionicons name={token.icon} size={14} color={token.fg} />
          <BloomText style={[styles.statusLabel, { color: token.fg }]}>
            {token.label}
          </BloomText>
        </View>
      </View>
      {viewing.propertyTitle ? (
        <BloomText style={styles.propertyTitle}>
          {viewing.propertyTitle}
        </BloomText>
      ) : null}
      {viewing.message ? (
        <BloomText style={styles.message}>{viewing.message}</BloomText>
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
              Reschedule
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
            Cancel
          </Button>
        </View>
      ) : null}
    </View>
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

  const handleModify = (viewing: ViewingRequest) => {
    router.push({
      pathname: `/properties/${viewing.propertyId}/book-viewing`,
      params: { modifyViewingId: viewing._id },
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
              icon="calendar-outline"
              title="Sign in to see your viewings"
              description="Schedule property visits and track host responses."
              actionText="Sign in"
              actionIcon="log-in-outline"
              onAction={() => showSignInModal()}
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
              const isActive = filter === entry.id;
              return (
                <Chip
                  key={entry.id}
                  onPress={() => setFilter(entry.id)}
                  variant={isActive ? 'solid' : 'outlined'}
                  color={isActive ? 'primary' : 'default'}
                  selected={isActive}
                >
                  {entry.label}
                </Chip>
              );
            })}
          </ScrollView>

          {viewingsQuery.isLoading ? <ViewingsSkeleton /> : null}

          {viewingsQuery.isError ? (
            <ErrorState
              icon="cloud-offline-outline"
              title={t('viewings.error.generic')}
              description={viewingsQuery.error?.message ?? 'Please try again.'}
              onRetry={() => viewingsQuery.refetch()}
            />
          ) : null}

          {!viewingsQuery.isLoading &&
          !viewingsQuery.isError &&
          filteredViewings.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="calendar-outline"
                title={t('viewings.empty.title')}
                description={t('viewings.empty.description')}
              />
            </View>
          ) : null}

          {filteredViewings.length > 0 ? (
            <View style={styles.listWrap}>
              {filteredViewings.map((viewing) => (
                <ViewingCard
                  key={viewing._id}
                  viewing={viewing}
                  cancelling={
                    cancelMutation.isPending &&
                    cancelTarget?._id === viewing._id
                  }
                  onCancel={() => setCancelTarget(viewing)}
                  onModify={() => handleModify(viewing)}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>

        <ConfirmDialog
          visible={cancelTarget !== null}
          title={t('viewings.actions.cancel')}
          message={t('viewings.cancel.confirmMessage')}
          confirmLabel={t('viewings.actions.cancel')}
          cancelLabel={t('common.cancel')}
          confirmDestructive
          loading={cancelMutation.isPending}
          onCancel={() => setCancelTarget(null)}
          onConfirm={() => {
            if (cancelTarget) cancelMutation.mutate(cancelTarget._id);
          }}
        />
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
  card: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
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
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  propertyTitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  message: {
    fontSize: 14,
    color: colors.muted,
    fontStyle: 'italic',
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
  skeletonCard: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skeletonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
