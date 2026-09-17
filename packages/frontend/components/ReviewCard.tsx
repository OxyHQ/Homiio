/**
 * ReviewCard — the canonical read view for a single reviucasa-style review.
 *
 * The PARENT hydrates the author (`useOxyAvatars(reviews.map(r => r.oxyUserId))`)
 * and passes the resolved Oxy `User` as `author`; the card renders the Bloom
 * `Avatar` (variant-aware resolver) + display name (falling back to the handle,
 * then an anonymous label). Body: title, Bloom `Rating`, recommendation line, opinion,
 * pros/cons (falling back to the legacy `positiveComment`/`negativeComment`),
 * dimension `Chip`s grouped by section (apartment / management / building /
 * area, only the present ones), advice blocks, an agency link, and a photo row.
 * Footer: a real Helpful toggle (disabled on your own review) + a Report action
 * (a per-user community report — never a moderator action), both Bloom `Button`s.
 */
import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@oxy.so/bloom/avatar';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import {
  RiAddCircleLine,
  RiAlertLine,
  RiArrowRightSLine,
  RiBuilding2Line,
  RiCloseCircleLine,
  RiFlagLine,
  RiThumbDownLine,
  RiThumbUpLine,
  RiVerifiedBadgeFill,
} from '@oxy.so/bloom/icons';
import { Rating } from '@oxy.so/bloom/rating';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { useOxy } from '@oxy.so/services';
import type { User } from '@oxy.so/core';

import {
  ReviewModerationStatus,
  type ReviewDTO,
  type ReviewReportReason,
} from '@homiio/shared-types';

import { ReportReviewSheet } from '@/components/reviews/ReportReviewSheet';
import {
  APARTMENT_DIMENSIONS,
  MANAGEMENT_DIMENSIONS,
  BUILDING_DIMENSIONS,
  AREA_DIMENSIONS,
  type DimensionDescriptor,
} from '@/components/reviews/dimensions';
import { useToggleHelpful, useReportReview } from '@/hooks/useReviewMutations';
import { resolveBackendImageUrl } from '@/utils/imageUrl';
import { formatLocalized } from '@/utils/dateLocale';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

interface DimensionChipData {
  /** Dimension name; omitted for a chip that is one value of a multi-value field. */
  label?: string;
  value: string;
}

/** Collect the i18n key pairs for every dimension present on the review. */
function collectEnumKeys(
  review: ReviewDTO,
  dimensions: DimensionDescriptor[],
): { labelKey: string; valueKey: string }[] {
  const chips: { labelKey: string; valueKey: string }[] = [];
  for (const dimension of dimensions) {
    const raw = review[dimension.field];
    if (typeof raw === 'string' && raw.length > 0) {
      chips.push({ labelKey: dimension.labelKey, valueKey: `${dimension.enumPrefix}.${raw}` });
    }
  }
  return chips;
}

interface DimensionGroupProps {
  title: string;
  chips: DimensionChipData[];
}

const DimensionGroup: React.FC<DimensionGroupProps> = ({ title, chips }) => {
  if (chips.length === 0) return null;
  return (
    <View style={styles.dimGroup}>
      <BloomText style={styles.eyebrow}>{title}</BloomText>
      <View style={styles.dimChips}>
        {chips.map((chip) => {
          const text = chip.label ? `${chip.label}: ${chip.value}` : chip.value;
          return (
            <Chip key={text} size="small" hue="gray">
              {text}
            </Chip>
          );
        })}
      </View>
    </View>
  );
};

export interface ReviewCardProps {
  review: ReviewDTO;
  /** Author resolved by the parent via `useOxyAvatars` (avatar file id + name). */
  author?: User;
  /** Fired with the agency slug when the "managed by" link is pressed. */
  onPressAgency?: (slug: string) => void;
}

export const ReviewCard: React.FC<ReviewCardProps> = ({ review, author, onPressAgency }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const { user } = useOxy();
  const toggleHelpful = useToggleHelpful();
  const reportReview = useReportReview();
  const [reportVisible, setReportVisible] = useState(false);

  const isOwnReview = Boolean(user?.id && user.id === review.oxyUserId);
  const displayName =
    author?.name?.displayName?.trim() || author?.username || t('reviews.card.anonymous');
  const isUnderReview = review.moderationStatus === ReviewModerationStatus.UNDER_REVIEW;

  const pros = review.prosItems?.length
    ? review.prosItems
    : review.positiveComment
      ? [review.positiveComment]
      : [];
  const cons = review.consItems?.length
    ? review.consItems
    : review.negativeComment
      ? [review.negativeComment]
      : [];

  const translateChips = (keys: { labelKey: string; valueKey: string }[]): DimensionChipData[] =>
    keys.map((entry) => ({ label: t(entry.labelKey), value: t(entry.valueKey) }));

  const apartmentChips = translateChips(collectEnumKeys(review, APARTMENT_DIMENSIONS));
  const managementChips = translateChips(collectEnumKeys(review, MANAGEMENT_DIMENSIONS));
  const buildingChips = translateChips(collectEnumKeys(review, BUILDING_DIMENSIONS));
  if (typeof review.touristApartments === 'boolean') {
    buildingChips.push({
      label: t('reviews.write.fields.touristApartments'),
      value: review.touristApartments ? t('common.yes') : t('common.no'),
    });
  }
  // One chip per shared service: a chip is a single line, and a joined list
  // would truncate.
  for (const service of review.services ?? []) {
    buildingChips.push({ value: t(`reviews.enums.services.${service}`) });
  }
  const areaChips = translateChips(collectEnumKeys(review, AREA_DIMENSIONS));

  const images = Array.isArray(review.images) ? review.images.filter((url) => Boolean(url)) : [];

  const handleReportSubmit = (reason: ReviewReportReason, details?: string) => {
    reportReview.mutate(
      { reviewId: review.id, reason, details },
      { onSuccess: () => setReportVisible(false) },
    );
  };

  const recommendColor = review.recommendation ? theme.colors.success : theme.colors.textSecondary;
  const RecommendIcon = review.recommendation ? RiThumbUpLine : RiThumbDownLine;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Avatar source={author?.avatar ?? undefined} variant="thumb" size={44} name={displayName} />
        <View style={styles.headerText}>
          <View style={styles.nameRow}>
            <BloomText style={[styles.authorName, { color: theme.colors.text }]}>
              {displayName}
            </BloomText>
            {review.verified ? (
              <Chip
                size="small"
                variant="subtle"
                color="success"
                startIcon={
                  <RiVerifiedBadgeFill width={12} height={12} fill={theme.colors.success} />
                }
              >
                {t('reviews.card.verified')}
              </Chip>
            ) : null}
            {isUnderReview ? (
              <Chip
                size="small"
                variant="subtle"
                color="warning"
                startIcon={<RiAlertLine width={12} height={12} fill={theme.colors.warning} />}
              >
                {t('reviews.card.underReview')}
              </Chip>
            ) : null}
          </View>
          <View style={styles.metaRow}>
            <BloomText style={styles.metaText}>
              {formatLocalized(new Date(review.createdAt), 'PP')}
            </BloomText>
            {review.livedForMonths > 0 ? (
              <>
                <BloomText style={styles.metaDot}>·</BloomText>
                <BloomText style={styles.metaText}>
                  {t('reviews.card.livedMonths', { count: review.livedForMonths })}
                </BloomText>
              </>
            ) : null}
            {review.price ? (
              <>
                <BloomText style={styles.metaDot}>·</BloomText>
                <BloomText style={styles.metaText}>
                  {t('reviews.card.perMonth', { price: review.price, currency: review.currency })}
                </BloomText>
              </>
            ) : null}
          </View>
        </View>
      </View>

      {review.title ? (
        <BloomText style={[styles.title, { color: theme.colors.text }]}>{review.title}</BloomText>
      ) : null}

      <View style={styles.ratingRow}>
        {review.rating > 0 ? (
          <Rating
            value={review.rating}
            accessibilityLabel={t('reviews.ratingA11y', { rating: review.rating })}
          />
        ) : null}
        <View style={styles.recommendRow}>
          <RecommendIcon width={14} height={14} fill={recommendColor} />
          <BloomText style={[styles.recommendText, { color: recommendColor }]}>
            {review.recommendation
              ? t('reviews.card.recommends')
              : t('reviews.card.doesNotRecommend')}
          </BloomText>
        </View>
      </View>

      {review.opinion ? <BloomText style={styles.opinion}>{review.opinion}</BloomText> : null}

      {pros.length > 0 ? (
        <View style={styles.prosConsBlock}>
          <BloomText style={[styles.eyebrow, { color: theme.colors.success }]}>
            {t('reviews.card.pros')}
          </BloomText>
          {pros.map((item, index) => (
            <View key={`pro-${index}`} style={styles.prosConsRow}>
              <RiAddCircleLine width={14} height={14} fill={theme.colors.success} />
              <BloomText style={styles.prosConsText}>{item}</BloomText>
            </View>
          ))}
        </View>
      ) : null}

      {cons.length > 0 ? (
        <View style={styles.prosConsBlock}>
          <BloomText style={[styles.eyebrow, { color: theme.colors.error }]}>
            {t('reviews.card.cons')}
          </BloomText>
          {cons.map((item, index) => (
            <View key={`con-${index}`} style={styles.prosConsRow}>
              <RiCloseCircleLine width={14} height={14} fill={theme.colors.error} />
              <BloomText style={styles.prosConsText}>{item}</BloomText>
            </View>
          ))}
        </View>
      ) : null}

      <DimensionGroup title={t('reviews.card.sections.apartment')} chips={apartmentChips} />
      <DimensionGroup title={t('reviews.card.sections.management')} chips={managementChips} />
      <DimensionGroup title={t('reviews.card.sections.building')} chips={buildingChips} />
      <DimensionGroup title={t('reviews.card.sections.area')} chips={areaChips} />

      {review.adviceToLandlord ? (
        <View style={[styles.adviceBlock, { borderLeftColor: theme.colors.border }]}>
          <BloomText style={styles.eyebrow}>{t('reviews.card.adviceToLandlord')}</BloomText>
          <BloomText style={styles.adviceText}>{review.adviceToLandlord}</BloomText>
        </View>
      ) : null}
      {review.adviceToAgency ? (
        <View style={[styles.adviceBlock, { borderLeftColor: theme.colors.border }]}>
          <BloomText style={styles.eyebrow}>{t('reviews.card.adviceToAgency')}</BloomText>
          <BloomText style={styles.adviceText}>{review.adviceToAgency}</BloomText>
        </View>
      ) : null}

      {review.agency ? (
        <Button
          variant="ghost"
          size="small"
          leadingIcon={RiBuilding2Line}
          trailingIcon={onPressAgency ? RiArrowRightSLine : undefined}
          onPress={() => onPressAgency?.(review.agency?.slug ?? '')}
          disabled={!onPressAgency}
          accessibilityLabel={t('reviews.card.managedBy', { name: review.agency.name })}
          style={styles.agencyLink}
        >
          {t('reviews.card.managedBy', { name: review.agency.name })}
        </Button>
      ) : null}

      {images.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.imagesRow}
        >
          {images.map((url, index) => (
            <Image
              key={`${url}-${index}`}
              source={{ uri: resolveBackendImageUrl(url) }}
              style={styles.reviewImage}
            />
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.footer}>
        <Button
          variant={review.viewerHasVotedHelpful ? 'secondary' : 'ghost'}
          size="small"
          leadingIcon={RiThumbUpLine}
          onPress={() => toggleHelpful.mutate(review.id)}
          disabled={isOwnReview || toggleHelpful.isPending}
          accessibilityLabel={t('reviews.card.helpful', { count: review.helpfulCount })}
        >
          {t('reviews.card.helpful', { count: review.helpfulCount })}
        </Button>
        {isOwnReview ? null : (
          <Button
            variant="ghost"
            size="small"
            leadingIcon={RiFlagLine}
            onPress={() => setReportVisible(true)}
            accessibilityLabel={t('reviews.card.report')}
          >
            {t('reviews.card.report')}
          </Button>
        )}
      </View>

      <ReportReviewSheet
        visible={reportVisible}
        onClose={() => setReportVisible(false)}
        onSubmit={handleReportSubmit}
        submitting={reportReview.isPending}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  authorName: {
    fontSize: 15,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  metaText: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  metaDot: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_5,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  recommendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  recommendText: {
    fontSize: 13,
    fontWeight: '600',
  },
  opinion: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.COLOR_BLACK_LIGHT_3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  prosConsBlock: {
    gap: spacing.xs,
  },
  prosConsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  prosConsText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  dimGroup: {
    gap: spacing.xs,
  },
  dimChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  adviceBlock: {
    gap: 2,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
  },
  adviceText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  agencyLink: {
    alignSelf: 'flex-start',
  },
  imagesRow: {
    gap: spacing.sm,
  },
  reviewImage: {
    width: 120,
    height: 90,
    borderRadius: radius.md,
    backgroundColor: colors.mutedSubtle,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});

export default ReviewCard;
