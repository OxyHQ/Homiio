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
import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  type TextLayoutEventData,
  type NativeSyntheticEvent,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import {
  RiAlertLine,
  RiThumbDownLine,
  RiThumbUpLine,
  RiUserLine,
  RiVerifiedBadgeFill,
} from '@oxy.so/bloom/icons';

import { Text as BloomText } from '@oxy.so/bloom/typography';

import { ReviewModerationStatus, type ReviewDTO } from '@homiio/shared-types';
import { Stars } from '@/components/ui/Stars';
import { reviewRentLabel } from '@/components/reviews/publishedFacts';
import { formatLocalized } from '@/utils/dateLocale';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

const BODY_CLAMP_LINES = 4;
const AVATAR_SIZE = 40;
const MAX_PROS_CONS = 3;

interface CommunityNoteCardProps {
  note: ReviewDTO;
}

export const CommunityNoteCard: React.FC<CommunityNoteCardProps> = ({ note }) => {
  const { t, i18n } = useTranslation();
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

  const pros = (note.prosItems?.length
    ? note.prosItems
    : note.positiveComment
      ? [note.positiveComment]
      : []
  ).slice(0, MAX_PROS_CONS);
  const cons = (note.consItems?.length
    ? note.consItems
    : note.negativeComment
      ? [note.negativeComment]
      : []
  ).slice(0, MAX_PROS_CONS);

  const handleTextLayout = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
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
          placeholderIcon={
            <RiUserLine width={20} height={20} fill={colors.COLOR_BLACK_LIGHT_3} />
          }
        />
        <View style={styles.headerText}>
          <View style={styles.nameRow}>
            <BloomText style={styles.authorName}>{authorName}</BloomText>
            {note.verified ? (
              <RiVerifiedBadgeFill
                width={15}
                height={15}
                fill={colors.primaryColor}
                accessibilityLabel={t('property.communityNotes.verifiedBadge')}
              />
            ) : null}
          </View>
          <View style={styles.metaRow}>
            <BloomText style={styles.metaText}>{formattedDate}</BloomText>
            {note.livedForMonths > 0 ? (
              <>
                <BloomText style={styles.metaDot}>·</BloomText>
                <BloomText style={styles.metaText}>
                  {t('property.communityNotes.livedMonths', { count: note.livedForMonths })}
                </BloomText>
              </>
            ) : null}
            {rentLabel ? (
              <>
                <BloomText style={styles.metaDot}>·</BloomText>
                <BloomText style={styles.metaText}>{rentLabel}</BloomText>
              </>
            ) : null}
          </View>
        </View>
        <Stars rating={note.rating} />
      </View>

      {note.title ? <BloomText style={styles.title}>{note.title}</BloomText> : null}

      <BloomText
        style={styles.body}
        numberOfLines={expanded ? undefined : BODY_CLAMP_LINES}
        onTextLayout={handleTextLayout}
      >
        {note.opinion}
      </BloomText>

      {isTruncatable ? (
        <Button
          variant="text"
          size="small"
          onPress={() => setExpanded((prev) => !prev)}
          style={styles.readMore}
        >
          {expanded
            ? t('property.communityNotes.readLess')
            : t('property.communityNotes.readMore')}
        </Button>
      ) : null}

      {pros.length > 0 ? (
        <View style={styles.commentBlock}>
          <BloomText style={styles.commentLabel}>{t('property.communityNotes.liked')}</BloomText>
          {pros.map((item, index) => (
            <BloomText key={`pro-${index}`} style={styles.commentText}>
              • {item}
            </BloomText>
          ))}
        </View>
      ) : null}

      {cons.length > 0 ? (
        <View style={styles.commentBlock}>
          <BloomText style={styles.commentLabel}>{t('property.communityNotes.disliked')}</BloomText>
          {cons.map((item, index) => (
            <BloomText key={`con-${index}`} style={styles.commentText}>
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
            <RiThumbDownLine width={13} height={13} fill={colors.COLOR_BLACK_LIGHT_3} />
          )}
          <BloomText
            style={[
              styles.recommendText,
              { color: note.recommendation ? colors.success : colors.COLOR_BLACK_LIGHT_3 },
            ]}
          >
            {note.recommendation
              ? t('property.communityNotes.recommends')
              : t('property.communityNotes.doesNotRecommend')}
          </BloomText>
        </View>

        {note.helpfulCount > 0 ? (
          <BloomText style={styles.helpfulCount}>
            {t('property.communityNotes.helpful', { count: note.helpfulCount })}
          </BloomText>
        ) : null}

        {note.moderationStatus === ReviewModerationStatus.UNDER_REVIEW ? (
          <Chip
            variant="subtle"
            color="warning"
            size="small"
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
  authorName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
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
    fontSize: 15,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  readMore: {
    alignSelf: 'flex-start',
  },
  commentBlock: {
    gap: 2,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.COLOR_BLACK_LIGHT_6,
  },
  commentLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.COLOR_BLACK_LIGHT_3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  commentText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.COLOR_BLACK_LIGHT_2,
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
  recommendText: {
    fontSize: 13,
    fontWeight: '600',
  },
  helpfulCount: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  underReview: {
    marginLeft: 'auto',
  },
});

export default CommunityNoteCard;
