/**
 * Admin moderation queue (hidden route — no sidebar entry).
 *
 * The reviews queue endpoint is the GATE: it is called on mount, and a 403
 * renders a clean "not authorised" state (i18n). There is NO client-side role
 * logic — the server allowlist (`requireAdmin`) is the sole authority.
 *
 * Two Bloom-chip tabs: Reseñas (reviews) / Desalojos (evictions). Each row shows
 * the reported content + its reports and offers admin actions (behind a confirm
 * prompt) that mutate + invalidate the queue. Actions use Bloom `Button` (owns
 * its own pressed state) — never a function-form `Pressable` style.
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import { Chip } from '@oxyhq/bloom/chip';
import { H2, H3, Text as BloomText } from '@oxyhq/bloom/typography';

import type {
  AdminReviewDTO,
  AdminReviewModerationAction,
  AdminEvictionModerationAction,
  EvictionModerationItem,
  ReviewReport,
  EvictionReportDTO,
} from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import {
  useModerationReviews,
  useModerationEvictions,
  useModerateReview,
  useModerateEviction,
} from '@/hooks/useAdminModeration';
import type { ReviewModerationFilter } from '@/services/adminModerationService';
import { webAlert } from '@/utils/api';
import { formatLocalized } from '@/utils/dateLocale';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

type Tab = 'reviews' | 'evictions';
type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

const REVIEW_FILTERS: ReviewModerationFilter[] = ['under_review', 'reported', 'removed'];

const REVIEW_STATUS_TONE: Record<string, Tone> = {
  active: 'success',
  under_review: 'warning',
  removed: 'error',
};

const EVICTION_STATUS_TONE: Record<string, Tone> = {
  upcoming: 'info',
  stopped: 'success',
  postponed: 'warning',
  executed: 'neutral',
  cancelled: 'error',
};

function toneColor(tone: Tone): string {
  switch (tone) {
    case 'success':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'error':
      return colors.error;
    case 'info':
      return colors.info;
    case 'neutral':
    default:
      return colors.textSecondary;
  }
}

/** Small bordered status pill (colored text + border, transparent fill). */
const StatusBadge: React.FC<{ label: string; tone: Tone }> = ({ label, tone }) => {
  const tint = toneColor(tone);
  return (
    <View style={[styles.badge, { borderColor: tint }]}>
      <BloomText style={[styles.badgeText, { color: tint }]}>{label}</BloomText>
    </View>
  );
};

/** ISO date → localized short date (formatLocalized reads the active locale). */
function safeDate(value: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatLocalized(parsed, 'PP');
}

interface ReportRowData {
  reasonLabel: string;
  details?: string;
  date: string;
}

const ReportRow: React.FC<ReportRowData> = ({ reasonLabel, details, date }) => (
  <View style={styles.reportRow}>
    <Ionicons name="flag" size={13} color={colors.error} style={styles.reportIcon} />
    <View style={styles.reportBody}>
      <View style={styles.reportMeta}>
        <BloomText style={styles.reportReason}>{reasonLabel}</BloomText>
        {date ? <BloomText style={styles.reportDate}>{date}</BloomText> : null}
      </View>
      {details ? <BloomText style={styles.reportDetails}>{details}</BloomText> : null}
    </View>
  </View>
);

// ---------------------------------------------------------------------------
// Review row.
// ---------------------------------------------------------------------------

interface AdminReviewRowProps {
  review: AdminReviewDTO;
  pending: boolean;
  onAction: (action: AdminReviewModerationAction) => void;
}

const AdminReviewRow: React.FC<AdminReviewRowProps> = ({ review, pending, onAction }) => {
  const { t } = useTranslation();
  const reports = Array.isArray(review.reports) ? review.reports : [];
  const isRemoved = review.moderationStatus === 'removed';

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <BloomText style={styles.rowTitle} numberOfLines={2}>
          {review.title || t('admin.moderation.reviews.untitled')}
        </BloomText>
        <StatusBadge
          label={t(`admin.moderation.reviewStatus.${review.moderationStatus}`)}
          tone={REVIEW_STATUS_TONE[review.moderationStatus] ?? 'neutral'}
        />
      </View>

      {review.opinion ? (
        <BloomText style={styles.rowExcerpt} numberOfLines={4}>
          {review.opinion}
        </BloomText>
      ) : null}

      <BloomText style={styles.rowMeta}>
        {t('admin.moderation.reviews.author', { id: review.oxyUserId })}
      </BloomText>

      {reports.length > 0 ? (
        <View style={styles.reportsBlock}>
          <BloomText style={styles.reportsTitle}>
            {t('admin.moderation.reports.title', { count: reports.length })}
          </BloomText>
          {reports.map((report: ReviewReport, index) => (
            <ReportRow
              key={`${report.oxyUserId}-${index}`}
              reasonLabel={t(`admin.moderation.reviewReason.${report.reason}`)}
              details={report.details}
              date={safeDate(report.createdAt)}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        {!isRemoved ? (
          <Button
            variant="destructive"
            size="small"
            loading={pending}
            onPress={() => onAction('remove')}
          >
            {t('admin.moderation.actions.remove')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="small"
            loading={pending}
            onPress={() => onAction('restore')}
          >
            {t('admin.moderation.actions.restore')}
          </Button>
        )}
        {reports.length > 0 ? (
          <Button
            variant="outline"
            size="small"
            loading={pending}
            onPress={() => onAction('dismiss_reports')}
          >
            {t('admin.moderation.actions.dismissReports')}
          </Button>
        ) : null}
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Eviction row.
// ---------------------------------------------------------------------------

interface AdminEvictionRowProps {
  item: EvictionModerationItem;
  pending: boolean;
  onOpen: () => void;
  onAction: (action: AdminEvictionModerationAction) => void;
}

const AdminEvictionRow: React.FC<AdminEvictionRowProps> = ({ item, pending, onOpen, onAction }) => {
  const { t } = useTranslation();
  const evictionCase = item.case;
  const reports = Array.isArray(item.reports) ? item.reports : [];
  const isCancelled = evictionCase.status === 'cancelled';
  const locationLabel = evictionCase.location?.label ?? '';
  const scheduled = safeDate(evictionCase.scheduledAt);

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Button
          variant="text"
          size="small"
          onPress={onOpen}
          style={styles.caseLink}
          accessibilityLabel={t('admin.moderation.evictions.viewCase')}
        >
          {evictionCase.title || t('admin.moderation.evictions.untitled')}
        </Button>
        <StatusBadge
          label={t(`evictions.status.${evictionCase.status}`)}
          tone={EVICTION_STATUS_TONE[evictionCase.status] ?? 'neutral'}
        />
      </View>

      <View style={styles.rowMetaRow}>
        {scheduled ? (
          <View style={styles.metaItem}>
            <Ionicons name="calendar-outline" size={13} color={colors.textSecondary} />
            <BloomText style={styles.rowMeta}>{scheduled}</BloomText>
          </View>
        ) : null}
        {locationLabel ? (
          <View style={styles.metaItem}>
            <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
            <BloomText style={styles.rowMeta} numberOfLines={1}>
              {locationLabel}
            </BloomText>
          </View>
        ) : null}
      </View>

      {reports.length > 0 ? (
        <View style={styles.reportsBlock}>
          <BloomText style={styles.reportsTitle}>
            {t('admin.moderation.reports.title', { count: reports.length })}
          </BloomText>
          {reports.map((report: EvictionReportDTO) => (
            <ReportRow
              key={report.id}
              reasonLabel={t(`admin.moderation.evictionReason.${report.reason}`)}
              details={report.details}
              date={safeDate(report.createdAt)}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        {!isCancelled ? (
          <Button
            variant="destructive"
            size="small"
            loading={pending}
            onPress={() => onAction('remove')}
          >
            {t('admin.moderation.actions.cancelCase')}
          </Button>
        ) : null}
        {reports.length > 0 ? (
          <Button
            variant="outline"
            size="small"
            loading={pending}
            onPress={() => onAction('dismiss_reports')}
          >
            {t('admin.moderation.actions.dismissReports')}
          </Button>
        ) : null}
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Screen.
// ---------------------------------------------------------------------------

export default function AdminModerationScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('reviews');
  const [reviewFilter, setReviewFilter] = useState<ReviewModerationFilter>('under_review');

  // Reviews query is ALWAYS enabled — it is the admin gate + the mount call.
  const reviewsQuery = useModerationReviews(reviewFilter);
  const evictionsQuery = useModerationEvictions({ enabled: tab === 'evictions' });

  const moderateReview = useModerateReview();
  const moderateEviction = useModerateEviction();

  const gateError = reviewsQuery.error as { status?: number } | null;
  const unauthorized = reviewsQuery.isError && gateError?.status === 403;

  const activeQuery = tab === 'reviews' ? reviewsQuery : evictionsQuery;
  const handleEndReached = useCallback(() => {
    if (activeQuery.hasNextPage && !activeQuery.isFetchingNextPage) {
      void activeQuery.fetchNextPage();
    }
  }, [activeQuery]);
  const { onScroll } = useInfiniteScroll({
    onEndReached: handleEndReached,
    enabled: activeQuery.hasNextPage,
  });

  const confirmAndRun = useCallback(
    (title: string, message: string, confirmLabel: string, destructive: boolean, run: () => void) => {
      webAlert(title, message, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: run },
      ]);
    },
    [t],
  );

  const onReviewAction = useCallback(
    (reviewId: string, action: AdminReviewModerationAction) => {
      const labelKey =
        action === 'remove'
          ? 'remove'
          : action === 'restore'
            ? 'restore'
            : 'dismissReports';
      confirmAndRun(
        t(`admin.moderation.confirm.review.${action}.title`),
        t(`admin.moderation.confirm.review.${action}.message`),
        t(`admin.moderation.actions.${labelKey}`),
        action === 'remove',
        () => moderateReview.mutate({ reviewId, action }),
      );
    },
    [confirmAndRun, moderateReview, t],
  );

  const onEvictionAction = useCallback(
    (caseId: string, action: AdminEvictionModerationAction) => {
      const labelKey = action === 'remove' ? 'cancelCase' : 'dismissReports';
      confirmAndRun(
        t(`admin.moderation.confirm.eviction.${action}.title`),
        t(`admin.moderation.confirm.eviction.${action}.message`),
        t(`admin.moderation.actions.${labelKey}`),
        action === 'remove',
        () => moderateEviction.mutate({ caseId, action }),
      );
    },
    [confirmAndRun, moderateEviction, t],
  );

  const reviewPendingId =
    moderateReview.isPending ? moderateReview.variables?.reviewId : undefined;
  const evictionPendingId =
    moderateEviction.isPending ? moderateEviction.variables?.caseId : undefined;

  const reviewsBody = () => {
    if (reviewsQuery.isLoading && reviewsQuery.reviews.length === 0) {
      return <BloomText style={styles.stateText}>{t('common.loading')}</BloomText>;
    }
    if (reviewsQuery.isError) {
      return (
        <ErrorState
          icon="cloud-offline-outline"
          title={t('admin.moderation.reviews.loadError')}
          description={reviewsQuery.error?.message ?? t('common.tryAgain')}
          onRetry={() => void reviewsQuery.refetch()}
        />
      );
    }
    if (reviewsQuery.reviews.length === 0) {
      return <BloomText style={styles.stateText}>{t('admin.moderation.reviews.empty')}</BloomText>;
    }
    return (
      <View style={styles.list}>
        {reviewsQuery.reviews.map((review) => (
          <AdminReviewRow
            key={review.id}
            review={review}
            pending={reviewPendingId === review.id}
            onAction={(action) => onReviewAction(review.id, action)}
          />
        ))}
      </View>
    );
  };

  const evictionsBody = () => {
    if (evictionsQuery.isLoading && evictionsQuery.items.length === 0) {
      return <BloomText style={styles.stateText}>{t('common.loading')}</BloomText>;
    }
    if (evictionsQuery.isError) {
      return (
        <ErrorState
          icon="cloud-offline-outline"
          title={t('admin.moderation.evictions.loadError')}
          description={evictionsQuery.error?.message ?? t('common.tryAgain')}
          onRetry={() => void evictionsQuery.refetch()}
        />
      );
    }
    if (evictionsQuery.items.length === 0) {
      return <BloomText style={styles.stateText}>{t('admin.moderation.evictions.empty')}</BloomText>;
    }
    return (
      <View style={styles.list}>
        {evictionsQuery.items.map((item) => (
          <AdminEvictionRow
            key={item.case.id}
            item={item}
            pending={evictionPendingId === item.case.id}
            onOpen={() => router.push(`/evictions/${item.case.id}`)}
            onAction={(action) => onEvictionAction(item.case.id, action)}
          />
        ))}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <Header options={{ title: t('admin.moderation.title') }} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        {unauthorized ? (
          <View style={styles.unauthorized}>
            <Ionicons name="lock-closed-outline" size={48} color={colors.textSecondary} />
            <H3 style={styles.unauthorizedTitle}>{t('admin.moderation.unauthorized.title')}</H3>
            <BloomText style={styles.unauthorizedMessage}>
              {t('admin.moderation.unauthorized.message')}
            </BloomText>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            onScroll={onScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.titleBlock}>
              <H2 style={styles.title}>{t('admin.moderation.title')}</H2>
              <BloomText style={styles.subtitle}>{t('admin.moderation.subtitle')}</BloomText>
            </View>

            <View style={styles.tabRow}>
              <Chip
                onPress={() => setTab('reviews')}
                variant={tab === 'reviews' ? 'solid' : 'outlined'}
                color={tab === 'reviews' ? 'primary' : 'default'}
                selected={tab === 'reviews'}
              >
                {t('admin.moderation.tabs.reviews')}
              </Chip>
              <Chip
                onPress={() => setTab('evictions')}
                variant={tab === 'evictions' ? 'solid' : 'outlined'}
                color={tab === 'evictions' ? 'primary' : 'default'}
                selected={tab === 'evictions'}
              >
                {t('admin.moderation.tabs.evictions')}
              </Chip>
            </View>

            {tab === 'reviews' ? (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.filterRow}
                >
                  {REVIEW_FILTERS.map((filter) => (
                    <Chip
                      key={filter}
                      onPress={() => setReviewFilter(filter)}
                      variant={reviewFilter === filter ? 'solid' : 'outlined'}
                      color={reviewFilter === filter ? 'primary' : 'default'}
                      selected={reviewFilter === filter}
                    >
                      {t(`admin.moderation.reviews.filters.${filter}`)}
                    </Chip>
                  ))}
                </ScrollView>
                {reviewsBody()}
              </>
            ) : (
              evictionsBody()
            )}

            <LoadMoreSentinel enabled={activeQuery.hasNextPage} onLoadMore={handleEndReached} />
          </ScrollView>
        )}
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
    paddingBottom: spacing['5xl'],
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
  tabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  list: {
    gap: spacing.md,
  },
  row: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  caseLink: {
    flex: 1,
    alignSelf: 'flex-start',
    paddingHorizontal: 0,
  },
  rowExcerpt: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  rowMeta: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  rowMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reportsBlock: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  reportsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  reportIcon: {
    marginTop: 2,
  },
  reportBody: {
    flex: 1,
    gap: 1,
  },
  reportMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  reportReason: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  reportDate: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  reportDetails: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  stateText: {
    fontSize: 14,
    color: colors.textSecondary,
    paddingVertical: spacing.xl,
    textAlign: 'center',
  },
  unauthorized: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  unauthorizedTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  unauthorizedMessage: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 340,
  },
});
