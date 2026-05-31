/**
 * CommunityNoteCard — a single community note (formerly "review") rendered
 * in the property detail's Community Notes section.
 *
 * Flat Airbnb-2026 aesthetic: no card chrome (no shadow, no border, no
 * filled background) so notes sit directly on the page like the rest of the
 * property sections. Separation between notes is owned by the parent via a
 * hairline divider.
 *
 * Layout:
 *  - Header row: avatar + author (Anonymous / Verified Resident) + a
 *    small verified check, with the star rating pinned to the right.
 *  - Meta line: date · months lived · monthly price.
 *  - Body: the note opinion, clamped to `BODY_CLAMP_LINES` with an inline
 *    "Read more" / "Read less" toggle when it overflows.
 *  - Footer (optional, full variant): a "Helpful" affordance + report /
 *    reply, plus a recommends / does-not-recommend pill.
 *
 * The underlying data shape is the Review model (`ReviewData`) — only the
 * presentation is rebranded. Notes are anonymous by design, so there is no
 * real name/photo to show; the avatar is a neutral glyph.
 */
import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  View,
  type TextLayoutEventData,
  type NativeSyntheticEvent,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { Stars } from '@/components/ui/Stars';
import { formatLocalized } from '@/utils/dateLocale';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

export interface ReviewData {
  _id: string;
  addressId: string;
  addressLevel: 'BUILDING' | 'UNIT';
  streetLevelId: string;
  buildingLevelId: string;
  unitLevelId?: string;
  greenHouse?: string;
  price: number;
  currency: string;
  livedFrom: string;
  livedTo: string;
  livedForMonths: number;
  recommendation: boolean;
  opinion: string;
  positiveComment?: string;
  negativeComment?: string;
  images: string[];
  rating: number;

  // Apartment-specific ratings (optional)
  summerTemperature?: string;
  winterTemperature?: string;
  noise?: string;
  light?: string;
  conditionAndMaintenance?: string;
  services?: string[];

  // Community-specific ratings (optional)
  landlordTreatment?: string;
  problemResponse?: string;
  depositReturned?: boolean;
  staircaseNeighbors?: string;
  touristApartments?: boolean;
  neighborRelations?: string;
  cleaning?: string;

  // Area-specific ratings (optional)
  areaTourists?: string;
  areaSecurity?: string;

  // Profile and metadata
  profileId: { id: string } | string;
  createdAt: string;
  updatedAt: string;
  verified: boolean;

  // Ethical review system features (optional, with defaults)
  isAnonymous?: boolean;
  confidenceScore?: number;
  evidenceAttached?: boolean;
  flaggedIssues?: string[];
  karmaScore?: number;
  replyAllowed?: boolean;
  moderationStatus?: 'pending' | 'approved' | 'flagged' | 'removed';
  takedownReason?: string;
  helpfulVotes?: number;
  unhelpfulVotes?: number;
  reportCount?: number;

  // Display fields
  livedDurationText?: string;
  evidenceCount?: number;
}

const BODY_CLAMP_LINES = 4;
const AVATAR_SIZE = 40;

interface FooterButtonProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  tone?: 'default' | 'active';
  onPress: () => void;
}

/** Footer affordance (Helpful / Report / Reply) — owns its own pressed state. */
const FooterButton: React.FC<FooterButtonProps> = ({
  icon,
  label,
  tone = 'default',
  onPress,
}) => {
  const [pressed, setPressed] = useState(false);
  const tint = tone === 'active' ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_3;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.footerButton, pressed && styles.footerButtonPressed]}
    >
      <Ionicons name={icon} size={16} color={tint} />
      <BloomText style={[styles.footerButtonLabel, { color: tint }]}>{label}</BloomText>
    </Pressable>
  );
};

interface CommunityNoteCardProps {
  note: ReviewData;
  onHelpful?: (noteId: string) => void;
  onReport?: (noteId: string) => void;
  onReply?: (noteId: string) => void;
  showActions?: boolean;
}

export const CommunityNoteCard: React.FC<CommunityNoteCardProps> = ({
  note,
  onHelpful,
  onReport,
  onReply,
  showActions = true,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [isTruncatable, setIsTruncatable] = useState(false);

  const authorName = note.isAnonymous
    ? t('property.communityNotes.anonymous')
    : t('property.communityNotes.verifiedResident');

  const formattedDate = formatLocalized(new Date(note.createdAt), 'MMMM yyyy');

  // Measure once (collapsed) to decide whether "Read more" is needed; the
  // measurement only matters before expansion, so it's a no-op afterwards.
  const handleTextLayout = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    if (!expanded && event.nativeEvent.lines.length > BODY_CLAMP_LINES) {
      setIsTruncatable(true);
    }
  };

  const handleHelpful = () => {
    if (onHelpful) {
      onHelpful(note._id);
      return;
    }
    Alert.alert(
      t('property.communityNotes.helpfulThanksTitle'),
      t('property.communityNotes.helpfulThanksBody'),
    );
  };

  const handleReport = () => {
    if (onReport) {
      onReport(note._id);
      return;
    }
    Alert.alert(
      t('property.communityNotes.reportTitle'),
      t('property.communityNotes.reportBody'),
      [
        { text: t('common.cancel', 'Cancel') || 'Cancel', style: 'cancel' },
        {
          text: t('property.communityNotes.reportConfirm'),
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              t('property.communityNotes.reportedTitle'),
              t('property.communityNotes.reportedBody'),
            ),
        },
      ],
    );
  };

  const handleReply = () => {
    if (onReply) {
      onReply(note._id);
      return;
    }
    Alert.alert(
      t('property.communityNotes.replyTitle'),
      t('property.communityNotes.replyBody'),
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={20} color={colors.COLOR_BLACK_LIGHT_3} />
        </View>
        <View style={styles.headerText}>
          <View style={styles.nameRow}>
            <BloomText style={styles.authorName}>{authorName}</BloomText>
            {note.verified ? (
              <Ionicons
                name="checkmark-circle"
                size={15}
                color={colors.primaryColor}
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
            {note.price > 0 ? (
              <>
                <BloomText style={styles.metaDot}>·</BloomText>
                <BloomText style={styles.metaText}>
                  {note.price} {note.currency}
                </BloomText>
              </>
            ) : null}
          </View>
        </View>
        <Stars rating={note.rating} />
      </View>

      <BloomText
        style={styles.body}
        numberOfLines={expanded ? undefined : BODY_CLAMP_LINES}
        onTextLayout={handleTextLayout}
      >
        {note.opinion}
      </BloomText>

      {isTruncatable ? (
        <Pressable
          onPress={() => setExpanded((prev) => !prev)}
          accessibilityRole="button"
          style={styles.readMore}
        >
          <BloomText style={styles.readMoreLabel}>
            {expanded
              ? t('property.communityNotes.readLess')
              : t('property.communityNotes.readMore')}
          </BloomText>
        </Pressable>
      ) : null}

      {note.positiveComment ? (
        <View style={styles.commentBlock}>
          <BloomText style={styles.commentLabel}>
            {t('property.communityNotes.liked')}
          </BloomText>
          <BloomText style={styles.commentText}>{note.positiveComment}</BloomText>
        </View>
      ) : null}

      {note.negativeComment ? (
        <View style={styles.commentBlock}>
          <BloomText style={styles.commentLabel}>
            {t('property.communityNotes.disliked')}
          </BloomText>
          <BloomText style={styles.commentText}>{note.negativeComment}</BloomText>
        </View>
      ) : null}

      {showActions ? (
        <View style={styles.footer}>
          <View style={styles.footerActions}>
            <FooterButton
              icon="thumbs-up-outline"
              tone={(note.helpfulVotes ?? 0) > 0 ? 'active' : 'default'}
              label={t('property.communityNotes.helpful', {
                count: note.helpfulVotes ?? 0,
              })}
              onPress={handleHelpful}
            />
            <FooterButton
              icon="flag-outline"
              label={t('property.communityNotes.report')}
              onPress={handleReport}
            />
            {note.replyAllowed ? (
              <FooterButton
                icon="chatbubble-outline"
                label={t('property.communityNotes.reply')}
                onPress={handleReply}
              />
            ) : null}
          </View>

          <View style={styles.recommendRow}>
            <Ionicons
              name={note.recommendation ? 'thumbs-up' : 'thumbs-down'}
              size={13}
              color={note.recommendation ? colors.success : colors.COLOR_BLACK_LIGHT_3}
            />
            <BloomText
              style={[
                styles.recommendText,
                {
                  color: note.recommendation
                    ? colors.success
                    : colors.COLOR_BLACK_LIGHT_3,
                },
              ]}
            >
              {note.recommendation
                ? t('property.communityNotes.recommends')
                : t('property.communityNotes.doesNotRecommend')}
            </BloomText>
          </View>

          {note.moderationStatus === 'flagged' ? (
            <View style={styles.underReview}>
              <Ionicons name="warning-outline" size={12} color={colors.warning} />
              <BloomText style={styles.underReviewText}>
                {t('property.communityNotes.underReview')}
              </BloomText>
            </View>
          ) : null}
        </View>
      ) : null}
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
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
    alignItems: 'center',
    justifyContent: 'center',
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
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  readMore: {
    alignSelf: 'flex-start',
  },
  readMoreLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    textDecorationLine: 'underline',
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
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
  },
  footerButtonPressed: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  footerButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  recommendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginLeft: 'auto',
  },
  recommendText: {
    fontSize: 13,
    fontWeight: '600',
  },
  underReview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.md,
    backgroundColor: colors.warningSubtle,
  },
  underReviewText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.warning,
  },
});

export default CommunityNoteCard;
