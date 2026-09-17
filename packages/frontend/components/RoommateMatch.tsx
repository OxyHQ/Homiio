/**
 * A discoverable roommate: identity, compatibility, headline preferences and
 * the request action. Built from Bloom `Card`, `Avatar`, `Chip` and `Textarea`;
 * feedback is a Bloom `toast`.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatPrice } from '@homiio/shared-types';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { Chip } from '@oxy.so/bloom/chip';
import {
  RiCalendarLine,
  RiEyeLine,
  RiHomeLine,
  RiSendPlaneLine,
  RiUserAddLine,
  RiWallet3Line,
} from '@oxy.so/bloom/icons';
import { Textarea } from '@oxy.so/bloom/textarea';
import { useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { H3, Text as BloomText } from '@oxy.so/bloom/typography';
import { FollowButton } from '@oxy.so/services';
import { SEARCH_PRICE_CURRENCY } from '@/components/search/types';
import { useFormatting } from '@/utils/format';
import type { RoommateProfile } from '@/hooks/useRoommate';
import { spacing } from '@/constants/styles';

interface RoommateMatchProps {
  profile: RoommateProfile;
  onSendRequest: (profileId: string, message?: string) => Promise<boolean>;
  onViewProfile: (profileId: string) => void;
}

const PREFERENCE_ICON_SIZE = 14;

export const RoommateMatch: React.FC<RoommateMatchProps> = ({
  profile,
  onSendRequest,
  onViewProfile,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale, priceUnitLabels } = useFormatting();
  const [isLoading, setIsLoading] = useState(false);
  const [showMessageInput, setShowMessageInput] = useState(false);
  const [message, setMessage] = useState('');

  const handleSendRequest = async () => {
    if (!showMessageInput) {
      setShowMessageInput(true);
      return;
    }

    setIsLoading(true);
    try {
      const success = await onSendRequest(profile.id, message);
      if (success) {
        setShowMessageInput(false);
        setMessage('');
        toast.success(t('roommates.alert.requestSent'));
      }
    } catch {
      toast.error(t('roommates.alert.requestFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const displayName = profile.displayName?.trim() || t('roommates.match.fallbackName');

  const matchTone = (score: number): 'success' | 'warning' | 'error' => {
    if (score >= 80) return 'success';
    if (score >= 60) return 'warning';
    return 'error';
  };

  const matchLabel = (score: number) => {
    if (score >= 80) return t('roommates.match.excellent');
    if (score >= 60) return t('roommates.match.good');
    return t('roommates.match.fair');
  };

  const preferences = profile.personalProfile?.settings?.roommate?.preferences;
  const iconFill = theme.colors.textSecondary;

  return (
    <Card variant="outlined" radius="radius-16" style={styles.card}>
      <View style={styles.header}>
        <Avatar
          name={displayName}
          size={56}
          onPress={() => onViewProfile(profile.id)}
        />

        <View style={styles.headerInfo}>
          <H3 numberOfLines={1}>{displayName}</H3>
          {profile.matchScore ? (
            <View style={styles.matchRow}>
              <Chip size="small" variant="subtle" color={matchTone(profile.matchScore)}>
                {t('roommates.match.compatibility', { score: profile.matchScore })}
              </Chip>
              <BloomText style={[styles.matchLabel, { color: theme.colors.textSecondary }]}>
                {matchLabel(profile.matchScore)}
              </BloomText>
            </View>
          ) : null}
        </View>

        <FollowButton userId={profile.oxyUserId} size="small" />
      </View>

      {profile.personalProfile?.personalInfo?.bio ? (
        <BloomText style={[styles.bio, { color: theme.colors.textSecondary }]}>
          {profile.personalProfile.personalInfo.bio}
        </BloomText>
      ) : null}

      {preferences ? (
        <View style={styles.section}>
          <BloomText style={styles.sectionTitle}>{t('roommates.match.preferences')}</BloomText>
          <View style={styles.chipRow}>
            <Chip
              size="small"
              variant="subtle"
              startIcon={
                <RiWallet3Line
                  width={PREFERENCE_ICON_SIZE}
                  height={PREFERENCE_ICON_SIZE}
                  fill={iconFill}
                />
              }
            >
              {formatPrice(
                {
                  amount: preferences.budget?.max || 0,
                  currency: SEARCH_PRICE_CURRENCY,
                  unit: 'month',
                },
                locale,
                { unitLabels: priceUnitLabels, maximumFractionDigits: 0 },
              )}
            </Chip>
            <Chip
              size="small"
              variant="subtle"
              startIcon={
                <RiCalendarLine
                  width={PREFERENCE_ICON_SIZE}
                  height={PREFERENCE_ICON_SIZE}
                  fill={iconFill}
                />
              }
            >
              {preferences.moveInDate || t('roommates.match.flexible')}
            </Chip>
            <Chip
              size="small"
              variant="subtle"
              startIcon={
                <RiHomeLine
                  width={PREFERENCE_ICON_SIZE}
                  height={PREFERENCE_ICON_SIZE}
                  fill={iconFill}
                />
              }
            >
              {preferences.leaseDuration || t('roommates.match.flexible')}
            </Chip>
          </View>
        </View>
      ) : null}

      {showMessageInput ? (
        <Textarea
          label={t('roommates.match.messageLabel')}
          value={message}
          onChangeText={setMessage}
          placeholder={t('roommates.match.messagePlaceholder')}
          maxLength={500}
          showCount
          autoResize
          maxRows={6}
        />
      ) : null}

      <View style={styles.actions}>
        <Button
          variant="ghost"
          leadingIcon={RiEyeLine}
          onPress={() => onViewProfile(profile.id)}
        >
          {t('roommates.match.viewProfile')}
        </Button>

        <Button
          leadingIcon={showMessageInput ? RiSendPlaneLine : RiUserAddLine}
          onPress={handleSendRequest}
          variant="primary"
          loading={isLoading}
          style={styles.sendRequestButton}
        >
          {t('roommates.match.sendRequest')}
        </Button>
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  matchLabel: {
    fontSize: 12,
  },
  bio: {
    fontSize: 14,
    lineHeight: 20,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  sendRequestButton: {
    flex: 1,
  },
});
