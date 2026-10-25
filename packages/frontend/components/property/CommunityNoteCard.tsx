/**
 * CommunityNoteCard — a single community note (a `ReviewDTO`) rendered in the
 * property detail's Community Notes preview. Flat Airbnb-2026 aesthetic (no card
 * chrome); separation is owned by the parent's hairline divider.
 *
 * Read-only: the full interactive review card (real Helpful / Report) lives on
 * the address page via `ReviewCard`. Here we surface the title, stars, opinion,
 * pros/cons (falling back to the legacy `positiveComment`/`negativeComment`),
 * the recommendation, a read-only helpful count, and an under-review flag.
 */
import type React from 'react';
import { useState } from 'react';
import { StyleSheet, View, type TextLayoutEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { RiAlertLine } from '@oxy.so/bloom/icons/RiAlertLine';
import { RiThumbDownLine } from '@oxy.so/bloom/icons/RiThumbDownLine';
import { RiThumbUpLine } from '@oxy.so/bloom/icons/RiThumbUpLine';
import { RiUserLine } from '@oxy.so/bloom/icons/RiUserLine';
import { RiVerifiedBadgeFill } from '@oxy.so/bloom/icons/RiVerifiedBadgeFill';

import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { ReviewModerationStatus, type ReviewDTO } from '@homiio/shared-types';
import { Stars } from '@/components/ui/Stars';
import { reviewRentLabel } from '@/components/reviews/publishedFacts';
import { formatLocalized } from '@/utils/dateLocale';
import { spacing } from '@/constants/styles';

const BODY_CLAMP_LINES = 4;
const AVATAR_SIZE = 40;
const MAX_PROS_CONS = 3;

interface CommunityNoteCardProps {
  note: ReviewDTO;
}

export const CommunityNoteCard: React.FC<CommunityNoteCardProps> = ({ note }) => {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [isTruncatable, setIsTruncatable] = useState(false);

  const authorName = note.verified
    ? t('property.communityNotes.verifiedResident')
    : t('property.communityNotes.anonymous');

  const formattedDate = formatLocalized(new Date(note.createdAt), 'MMMM yyyy');
  // The rent this note PUBLISHES — a band for anybody but its author (ADR 0003
  // §5.6). This card used to print `note.price` raw, which is the exact figure
  // the API no longer serves to a third party.
  const rentLabel = reviewRentLabel(note, i18n.language, t);

  const pros = (
    note.prosItems?.length ? note.prosItems : note.positiveComment ? [note.positiveComment] : []
  ).slice(0, MAX_PROS_CONS);
  const cons = (
    note.consItems?.length ? note.consItems : note.negativeComment ? [note.negativeComment] : []
  ).slice(0, MAX_PROS_CONS);

  const handleTextLayout = (event: TextLayoutEvent) => {
    if (!expanded && event.nativeEvent.lines.length > BODY_CLAMP_LINES) {
      setIsTruncatable(true);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Avatar
          size={AVATAR_SIZE}
          color="neutral"
          placeholderIcon={<RiUserLine width={20} height={20} fill={colors.textSecondary} />}
        />
        <View style={styles.headerText}>
          <View style={styles.nameRow}>
            <BloomText className="text-[15px] font-semibold text-foreground">
              {authorName}
            </BloomText>
            {note.verified ? (
              <RiVerifiedBadgeFill
                width={15}
                height={15}
                fill={colors.primarySubtleForeground}
                accessibilityLabel={t('property.communityNotes.verifiedBadge')}
              />
            ) : null}
          </View>
          <View style={styles.metaRow}>
            <BloomText className="text-[13px] text-muted-foreground">{formattedDate}</BloomText>
            {note.livedForMonths > 0 ? (
              <>
                <BloomText className="text-[13px] text-text-tertiary">·</BloomText>
                <BloomText className="text-[13px] text-muted-foreground">
                  {t('property.communityNotes.livedMonths', { count: note.livedForMonths })}
                </BloomText>
              </>
            ) : null}
            {rentLabel ? (
              <>
                <BloomText className="text-[13px] text-text-tertiary">·</BloomText>
                <BloomText className="text-[13px] text-muted-foreground">{rentLabel}</BloomText>
              </>
            ) : null}
          </View>
        </View>
        <Stars rating={note.rating} />
      </View>

      {note.title ? (
        <BloomText className="text-[15px] font-bold text-foreground">{note.title}</BloomText>
      ) : null}

      <BloomText
        className="text-[15px] leading-[22px] text-foreground"
        numberOfLines={expanded ? undefined : BODY_CLAMP_LINES}
        onTextLayout={handleTextLayout}
      >
        {note.opinion}
      </BloomText>

      {isTruncatable ? (
        <Button
          size="sm"
          onPress={() => setExpanded((prev) => !prev)}
          style={styles.readMore}
          tone="accent"
          appearance="plain"
        >
          {expanded ? t('property.communityNotes.readLess') : t('property.communityNotes.readMore')}
        </Button>
      ) : null}

      {pros.length > 0 ? (
        <View className="gap-0.5 border-l-2 border-border pl-3">
          <BloomText className="text-xs font-bold uppercase tracking-[0.5px] text-muted-foreground">
            {t('property.communityNotes.liked')}
          </BloomText>
          {pros.map((item, index) => (
            <BloomText key={`pro-${index}`} className="text-sm leading-5 text-foreground">
              • {item}
            </BloomText>
          ))}
        </View>
      ) : null}

      {cons.length > 0 ? (
        <View className="gap-0.5 border-l-2 border-border pl-3">
          <BloomText className="text-xs font-bold uppercase tracking-[0.5px] text-muted-foreground">
            {t('property.communityNotes.disliked')}
          </BloomText>
          {cons.map((item, index) => (
            <BloomText key={`con-${index}`} className="text-sm leading-5 text-foreground">
              • {item}
            </BloomText>
          ))}
        </View>
      ) : null}

      <View style={styles.footer}>
        <View style={styles.recommendRow}>
          {note.recommendation ? (
            <RiThumbUpLine width={13} height={13} fill={colors.success} />
          ) : (
            <RiThumbDownLine width={13} height={13} fill={colors.textSecondary} />
          )}
          <BloomText
            className={
              note.recommendation
                ? 'text-[13px] font-semibold text-success'
                : 'text-[13px] font-semibold text-muted-foreground'
            }
          >
            {note.recommendation
              ? t('property.communityNotes.recommends')
              : t('property.communityNotes.doesNotRecommend')}
          </BloomText>
        </View>

        {note.helpfulCount > 0 ? (
          <BloomText className="text-[13px] text-muted-foreground">
            {t('property.communityNotes.helpful', { count: note.helpfulCount })}
          </BloomText>
        ) : null}

        {note.moderationStatus === ReviewModerationStatus.UNDER_REVIEW ? (
          <Chip
            variant="subtle"
            color="warning"
            size="sm"
            startIcon={<RiAlertLine width={12} height={12} fill={colors.warning} />}
            style={styles.underReview}
          >
            {t('property.communityNotes.underReview')}
          </Chip>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
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
    gap: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  readMore: {
    alignSelf: 'flex-start',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  recommendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  underReview: {
    marginLeft: 'auto',
  },
});
