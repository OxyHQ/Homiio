/**
 * ReviewCard — the canonical read view for a single reviucasa-style review.
 *
 * The PARENT hydrates the author (`useOxyAvatars(reviews.map(r => r.oxyUserId))`)
 * and passes the resolved Oxy `User` as `author`; the card renders the Bloom
 * `Avatar` (variant-aware resolver) + display name (falling back to the handle,
 * then an anonymous label). Body: title, stars, recommendation line, opinion,
 * pros/cons (falling back to the legacy `positiveComment`/`negativeComment`),
 * dimension chips grouped by section (apartment / management / building / area,
 * only the present ones), advice blocks, an agency link, and a photo row.
 * Footer: a real Helpful toggle (disabled on your own review) + a Report action.
 */
import React, { useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Avatar } from '@oxyhq/bloom/avatar';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { useOxy } from '@oxyhq/services';
import type { User } from '@oxyhq/core';

import {
  ReviewModerationStatus,
  type ReviewDTO,
  type ReviewReportReason,
} from '@homiio/shared-types';

import { Stars } from '@/components/ui/Stars';
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
import { hairline, radius, spacing } from '@/constants/styles';

const IS_WEB = Platform.OS === 'web';

interface DimensionChipData {
  label: string;
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

const DimensionChip: React.FC<DimensionChipData> = ({ label, value }) => (
  <View style={styles.dimChip}>
    <BloomText style={styles.dimChipLabel}>{label}</BloomText>
    <BloomText style={styles.dimChipValue}>{value}</BloomText>
  </View>
);

interface DimensionGroupProps {
  title: string;
  chips: DimensionChipData[];
}

const DimensionGroup: React.FC<DimensionGroupProps> = ({ title, chips }) => {
  if (chips.length === 0) return null;
  return (
    <View style={styles.dimGroup}>
      <BloomText style={styles.dimGroupTitle}>{title}</BloomText>
      <View style={styles.dimChips}>
        {chips.map((chip) => (
          <DimensionChip key={chip.label} label={chip.label} value={chip.value} />
        ))}
      </View>
    </View>
  );
};

interface FooterButtonProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/** Footer affordance (Helpful / Report) — owns its own pressed/hovered state. */
const FooterButton: React.FC<FooterButtonProps> = ({ icon, label, active, disabled, onPress }) => {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const tint = active ? colors.success : colors.COLOR_BLACK_LIGHT_3;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onHoverIn={IS_WEB ? () => setHovered(true) : undefined}
      onHoverOut={IS_WEB ? () => setHovered(false) : undefined}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(active) }}
      style={[
        styles.footerButton,
        !disabled && (pressed || hovered) && styles.footerButtonActive,
        disabled && styles.footerButtonDisabled,
      ]}
    >
      <Ionicons name={icon} size={16} color={tint} />
      <BloomText style={[styles.footerButtonLabel, { color: tint }]}>{label}</BloomText>
    </Pressable>
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
  if (review.services && review.services.length > 0) {
    buildingChips.push({
      label: t('reviews.write.fields.services'),
      value: review.services.map((service) => t(`reviews.enums.services.${service}`)).join(', '),
    });
  }
  const areaChips = translateChips(collectEnumKeys(review, AREA_DIMENSIONS));

  const images = Array.isArray(review.images) ? review.images.filter((url) => Boolean(url)) : [];

  const handleReportSubmit = (reason: ReviewReportReason, details?: string) => {
    reportReview.mutate(
      { reviewId: review.id, reason, details },
      { onSuccess: () => setReportVisible(false) },
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Avatar source={author?.avatar ?? undefined} variant="thumb" size={44} />
        <View style={styles.headerText}>
          <View style={styles.nameRow}>
            <BloomText style={styles.authorName}>{displayName}</BloomText>
            {review.verified ? (
              <View style={styles.chip}>
                <Ionicons name="checkmark-circle" size={13} color={colors.success} />
                <BloomText style={[styles.chipText, { color: colors.success }]}>
                  {t('reviews.card.verified')}
                </BloomText>
              </View>
            ) : null}
            {isUnderReview ? (
              <View style={[styles.chip, styles.chipWarning]}>
                <Ionicons name="warning-outline" size={12} color={colors.warning} />
                <BloomText style={[styles.chipText, { color: colors.warning }]}>
                  {t('reviews.card.underReview')}
                </BloomText>
              </View>
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

      {review.title ? <BloomText style={styles.title}>{review.title}</BloomText> : null}

      <View style={styles.ratingRow}>
        <Stars rating={review.rating} size={16} />
        <View style={styles.recommendRow}>
          <Ionicons
            name={review.recommendation ? 'thumbs-up' : 'thumbs-down'}
            size={14}
            color={review.recommendation ? colors.success : colors.COLOR_BLACK_LIGHT_3}
          />
          <BloomText
            style={[
              styles.recommendText,
              { color: review.recommendation ? colors.success : colors.COLOR_BLACK_LIGHT_3 },
            ]}
          >
            {review.recommendation
              ? t('reviews.card.recommends')
              : t('reviews.card.doesNotRecommend')}
          </BloomText>
        </View>
      </View>

      {review.opinion ? <BloomText style={styles.opinion}>{review.opinion}</BloomText> : null}

      {pros.length > 0 ? (
        <View style={styles.prosConsBlock}>
          <BloomText style={[styles.prosConsLabel, { color: colors.success }]}>
            {t('reviews.card.pros')}
          </BloomText>
          {pros.map((item, index) => (
            <View key={`pro-${index}`} style={styles.prosConsRow}>
              <Ionicons name="add-circle-outline" size={14} color={colors.success} />
              <BloomText style={styles.prosConsText}>{item}</BloomText>
            </View>
          ))}
        </View>
      ) : null}

      {cons.length > 0 ? (
        <View style={styles.prosConsBlock}>
          <BloomText style={[styles.prosConsLabel, { color: colors.error }]}>
            {t('reviews.card.cons')}
          </BloomText>
          {cons.map((item, index) => (
            <View key={`con-${index}`} style={styles.prosConsRow}>
              <Ionicons name="remove-circle-outline" size={14} color={colors.error} />
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
        <View style={styles.adviceBlock}>
          <BloomText style={styles.adviceLabel}>{t('reviews.card.adviceToLandlord')}</BloomText>
          <BloomText style={styles.adviceText}>{review.adviceToLandlord}</BloomText>
        </View>
      ) : null}
      {review.adviceToAgency ? (
        <View style={styles.adviceBlock}>
          <BloomText style={styles.adviceLabel}>{t('reviews.card.adviceToAgency')}</BloomText>
          <BloomText style={styles.adviceText}>{review.adviceToAgency}</BloomText>
        </View>
      ) : null}

      {review.agency ? (
        <Pressable
          onPress={() => onPressAgency?.(review.agency?.slug ?? '')}
          disabled={!onPressAgency}
          accessibilityRole="link"
          accessibilityLabel={t('reviews.card.managedBy', { name: review.agency.name })}
          style={styles.agencyRow}
        >
          <Ionicons name="business-outline" size={15} color={colors.primaryColor} />
          <BloomText style={styles.agencyText}>
            {t('reviews.card.managedBy', { name: review.agency.name })}
          </BloomText>
          {onPressAgency ? (
            <Ionicons name="chevron-forward" size={14} color={colors.primaryColor} />
          ) : null}
        </Pressable>
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
        <FooterButton
          icon={review.viewerHasVotedHelpful ? 'thumbs-up' : 'thumbs-up-outline'}
          label={t('reviews.card.helpful', { count: review.helpfulCount })}
          active={review.viewerHasVotedHelpful}
          disabled={isOwnReview || toggleHelpful.isPending}
          onPress={() => toggleHelpful.mutate(review.id)}
        />
        {isOwnReview ? null : (
          <FooterButton
            icon="flag-outline"
            label={t('reviews.card.report')}
            onPress={() => setReportVisible(true)}
          />
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
    color: colors.COLOR_BLACK,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.successSubtle,
  },
  chipWarning: {
    backgroundColor: colors.warningSubtle,
  },
  chipText: {
    fontSize: 11,
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
    color: colors.COLOR_BLACK,
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
  prosConsBlock: {
    gap: spacing.xs,
  },
  prosConsLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
  dimGroupTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.COLOR_BLACK_LIGHT_3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dimChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  dimChip: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: hairline.width,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    backgroundColor: colors.surfaceElevated,
  },
  dimChipLabel: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  dimChipValue: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  adviceBlock: {
    gap: 2,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.COLOR_BLACK_LIGHT_6,
  },
  adviceLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.COLOR_BLACK_LIGHT_3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  adviceText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  agencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
  },
  agencyText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primaryColor,
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
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
  },
  footerButtonActive: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  footerButtonDisabled: {
    opacity: 0.6,
  },
  footerButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
});

export default ReviewCard;
