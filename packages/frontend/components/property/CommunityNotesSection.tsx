/**
 * CommunityNotesSection — the "Community Notes" block on the property detail.
 * Community-sourced notes about the building, served from
 * `/api/reviews/address/:id` via the shared `useAddressReviews` hook (the same
 * `['addressReviews', addressId]` cache the booking card + reviews block read).
 *
 * Airbnb-2026 flat aesthetic (matches the other property sections): no cards or
 * shadows; blocks separated by hairlines and inset by `SECTION_GUTTER`.
 *
 * Composition: a rating summary (average + star distribution), a client-side
 * sort control (the endpoint does not sort), and a list of read-only
 * `CommunityNoteCard`s capped at `maxVisible` with a "Show all" toggle + a
 * "View all" link to the address page.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { H1, Text as BloomText } from '@oxyhq/bloom/typography';

import { CommunityNoteCard } from '@/components/property/CommunityNoteCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Stars } from '@/components/ui/Stars';
import { SectionHeader, SECTION_GUTTER } from '@/components/property/Section';
import { useAddressReviews } from '@/hooks/useAddressReviews';
import { colors } from '@/styles/colors';
import { hairline, radius, spacing } from '@/constants/styles';
import type { Property, ReviewDTO } from '@homiio/shared-types';

interface CommunityNotesSectionProps {
  property: Property;
  variant?: 'full' | 'preview';
}

type SortKey = 'recent' | 'highest' | 'helpful';

const STAR_SCALE = [5, 4, 3, 2, 1] as const;
const SUMMARY_STAR_SIZE = 16;

interface AggregatedStats {
  averageRating: number;
  totalNotes: number;
  distribution: Record<number, number>;
}

const computeStats = (notes: ReviewDTO[]): AggregatedStats | null => {
  if (notes.length === 0) return null;
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let ratingSum = 0;
  for (const note of notes) {
    const rating = note.rating || 0;
    ratingSum += rating;
    const bucket = Math.min(STAR_SCALE[0], Math.max(1, Math.round(rating)));
    distribution[bucket] += 1;
  }
  return {
    averageRating: ratingSum / notes.length,
    totalNotes: notes.length,
    distribution,
  };
};

const sortNotes = (notes: ReviewDTO[], sort: SortKey): ReviewDTO[] => {
  const copy = [...notes];
  switch (sort) {
    case 'highest':
      return copy.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    case 'helpful':
      return copy.sort((a, b) => (b.helpfulCount ?? 0) - (a.helpfulCount ?? 0));
    case 'recent':
    default:
      return copy.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }
};

interface RatingSummaryProps {
  stats: AggregatedStats;
}

const RatingSummary: React.FC<RatingSummaryProps> = ({ stats }) => {
  const { t } = useTranslation();
  return (
    <View style={styles.summary}>
      <View style={styles.summaryScore}>
        <H1 style={styles.summaryNumber}>{stats.averageRating.toFixed(1)}</H1>
        <View style={styles.summaryScoreMeta}>
          <Stars rating={stats.averageRating} size={SUMMARY_STAR_SIZE} />
          <BloomText style={styles.summaryCount}>
            {t('property.communityNotes.count', { count: stats.totalNotes })}
          </BloomText>
        </View>
      </View>

      <View
        style={styles.distribution}
        accessibilityLabel={t('property.communityNotes.distributionLabel')}
      >
        {STAR_SCALE.map((star) => {
          const count = stats.distribution[star] ?? 0;
          const ratio = stats.totalNotes > 0 ? count / stats.totalNotes : 0;
          return (
            <View key={star} style={styles.distributionRow}>
              <BloomText style={styles.distributionStar}>{star}</BloomText>
              <Ionicons name="star" size={11} color={colors.COLOR_BLACK_LIGHT_5} />
              <View style={styles.distributionTrack}>
                <View
                  style={[styles.distributionFill, { width: `${Math.round(ratio * 100)}%` }]}
                />
              </View>
              <BloomText style={styles.distributionCount}>{count}</BloomText>
            </View>
          );
        })}
      </View>
    </View>
  );
};

interface SortChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

/** Sort pill — owns its own pressed/hovered state (lives in a `.map()`). */
const SortChip: React.FC<SortChipProps> = ({ label, active, onPress }) => {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={[
        styles.sortChip,
        active && styles.sortChipActive,
        !active && (pressed || hovered) && styles.sortChipHovered,
      ]}
    >
      <BloomText style={[styles.sortChipLabel, active && styles.sortChipLabelActive]}>
        {label}
      </BloomText>
    </Pressable>
  );
};

export const CommunityNotesSection: React.FC<CommunityNotesSectionProps> = ({
  property,
  variant = 'preview',
}) => {
  const { t } = useTranslation();
  const router = useRouter();

  const isPreview = variant === 'preview';
  const maxVisible = isPreview ? 4 : 10;

  const [sort, setSort] = useState<SortKey>('recent');
  const [expanded, setExpanded] = useState(false);

  const {
    addressId,
    reviews: notes,
    query: { isLoading: loading, error: queryError, refetch },
  } = useAddressReviews(property);

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : t('property.communityNotes.errorTitle')
    : null;

  const stats = useMemo(() => computeStats(notes), [notes]);
  const sortedNotes = useMemo(() => sortNotes(notes, sort), [notes, sort]);

  const visibleNotes = useMemo(
    () => (expanded ? sortedNotes : sortedNotes.slice(0, maxVisible)),
    [sortedNotes, expanded, maxVisible],
  );

  if (!addressId) return null;

  const handleViewAll = () => {
    router.push(`/addresses/${addressId}?tab=reviews`);
  };

  const handleAddNote = () => {
    router.push(`/reviews/write?addressId=${addressId}`);
  };

  const hasNotes = !loading && !error && notes.length > 0;
  const showSort = hasNotes && notes.length > 1;
  const canExpandInline = notes.length > maxVisible && !expanded;
  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'recent', label: t('property.communityNotes.sort.recent') },
    { key: 'highest', label: t('property.communityNotes.sort.highest') },
    { key: 'helpful', label: t('property.communityNotes.sort.helpful') },
  ];

  return (
    <View>
      <SectionHeader
        title={t('property.communityNotes.title')}
        subtitle={t('property.communityNotes.subtitle')}
      />

      <View style={styles.body}>
        {loading ? (
          <View style={styles.skeletonList}>
            {Array.from({ length: 3 }).map((_, idx) => (
              <View key={idx} style={styles.skeletonCard}>
                <View style={styles.skeletonHeader}>
                  <Skeleton.Box width={40} height={40} borderRadius={20} />
                  <View style={styles.skeletonHeaderText}>
                    <Skeleton.Box width="50%" height={13} borderRadius={4} />
                    <Skeleton.Box width="35%" height={11} borderRadius={4} style={styles.skeletonLine} />
                  </View>
                </View>
                <Skeleton.Box width="100%" height={12} borderRadius={4} style={styles.skeletonLine} />
                <Skeleton.Box width="80%" height={12} borderRadius={4} style={styles.skeletonLine} />
              </View>
            ))}
          </View>
        ) : null}

        {error ? (
          <ErrorState
            icon="chatbubbles-outline"
            title={t('property.communityNotes.errorTitle')}
            description={error}
            retryLabel={t('common.tryAgain')}
            onRetry={() => {
              refetch();
            }}
          />
        ) : null}

        {!loading && !error && notes.length === 0 ? (
          <EmptyState
            icon="chatbubbles-outline"
            title={t('property.communityNotes.emptyTitle')}
            description={t('property.communityNotes.emptyDescription')}
            actionText={t('property.communityNotes.addAction')}
            actionIcon="create-outline"
            onAction={handleAddNote}
          />
        ) : null}

        {hasNotes ? (
          <>
            {stats ? <RatingSummary stats={stats} /> : null}

            {showSort ? (
              <View style={styles.sortRow}>
                {sortOptions.map((option) => (
                  <SortChip
                    key={option.key}
                    label={option.label}
                    active={sort === option.key}
                    onPress={() => setSort(option.key)}
                  />
                ))}
              </View>
            ) : null}

            <View style={styles.notesList}>
              {visibleNotes.map((note, index) => (
                <View
                  key={note.id}
                  style={[styles.noteRow, index > 0 && styles.noteRowDivider]}
                >
                  <CommunityNoteCard note={note} />
                </View>
              ))}
            </View>

            <View style={styles.actionsRow}>
              {canExpandInline ? (
                <Button
                  onPress={() => setExpanded(true)}
                  variant="secondary"
                  size="medium"
                  accessibilityLabel={t('property.communityNotes.showAll', { count: notes.length })}
                >
                  {t('property.communityNotes.showAll', { count: notes.length })}
                </Button>
              ) : null}

              {isPreview && notes.length > 0 ? (
                <Button
                  onPress={handleViewAll}
                  variant="ghost"
                  size="medium"
                  icon={<Ionicons name="open-outline" size={16} color={colors.COLOR_BLACK} />}
                  iconPosition="left"
                  accessibilityLabel={t('property.communityNotes.showMore')}
                >
                  {t('property.communityNotes.showMore')}
                </Button>
              ) : null}

              <Button
                onPress={handleAddNote}
                variant="ghost"
                size="medium"
                icon={<Ionicons name="create-outline" size={16} color={colors.COLOR_BLACK} />}
                iconPosition="left"
                accessibilityLabel={t('property.communityNotes.addAction')}
              >
                {t('property.communityNotes.addAction')}
              </Button>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: SECTION_GUTTER,
    marginTop: spacing.md,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing['3xl'],
    paddingBottom: spacing.xl,
    marginBottom: spacing.lg,
    borderBottomWidth: hairline.width,
    borderBottomColor: hairline.color,
  },
  summaryScore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  summaryNumber: {
    fontSize: 44,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: -1,
  },
  summaryScoreMeta: {
    gap: spacing.xs,
  },
  summaryCount: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  distribution: {
    flex: 1,
    minWidth: 200,
    gap: spacing.xs,
  },
  distributionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  distributionStar: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
    width: 10,
    textAlign: 'right',
  },
  distributionTrack: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
    overflow: 'hidden',
  },
  distributionFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.COLOR_BLACK,
  },
  distributionCount: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
    minWidth: 20,
    textAlign: 'right',
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  sortChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: hairline.width,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    backgroundColor: colors.surfaceElevated,
  },
  sortChipHovered: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  sortChipActive: {
    backgroundColor: colors.COLOR_BLACK,
    borderColor: colors.COLOR_BLACK,
  },
  sortChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  sortChipLabelActive: {
    color: colors.white,
  },
  notesList: {
    gap: 0,
  },
  noteRow: {
    paddingVertical: spacing.xl,
  },
  noteRowDivider: {
    borderTopWidth: hairline.width,
    borderTopColor: hairline.color,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  skeletonList: {
    gap: spacing.xl,
  },
  skeletonCard: {
    gap: spacing.sm,
  },
  skeletonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  skeletonHeaderText: {
    flex: 1,
  },
  skeletonLine: {
    marginTop: spacing.xs,
  },
});

export default CommunityNotesSection;
