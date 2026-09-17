/**
 * Roommate profile detail — `/roommates/:id`.
 *
 * Sections are Bloom `Card`s, identity is a Bloom `Avatar`, trust signals are
 * Bloom `Chip`s and the request outcome is a Bloom `toast`.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { Chip } from '@oxy.so/bloom/chip';
import {
  RiCheckboxBlankCircleLine,
  RiCheckboxCircleFill,
  RiMapPinLine,
} from '@oxy.so/bloom/icons';
import { Loading } from '@oxy.so/bloom/loading';
import { useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { H2, H3, Text as BloomText } from '@oxy.so/bloom/typography';
import { FollowButton, useFollow, useOxy } from '@oxy.so/services';
import { useTranslation } from 'react-i18next';

import { Header } from '@/components/Header';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { useRoommate } from '@/hooks/useRoommate';
import profileService from '@/services/profileService';
import { roommateService } from '@/services/roommateService';
import { spacing } from '@/constants/styles';
import { colors } from '@/styles/colors';

export default function RoommateProfilePage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { user } = useOxy();
  const params = useLocalSearchParams<{ id: string }>();
  const oxyUserId = String(params.id);
  const isOwnProfile = Boolean(user?.id && user.id === oxyUserId);
  const { followerCount, followingCount } = useFollow(oxyUserId);
  const { sendRequest } = useRoommate();
  const [isSending, setIsSending] = useState(false);

  const profileQuery = useQuery({
    queryKey: ['roommates', 'profile', oxyUserId],
    queryFn: async () => profileService.getProfileByOxyUserId(oxyUserId),
    enabled: Boolean(oxyUserId),
    staleTime: 1000 * 30,
  });

  const profile = profileQuery.data;
  const info = profile ? roommateService.getProfileDisplayInfo(profile) : null;

  const handleSendRequest = async () => {
    setIsSending(true);
    try {
      const ok = await sendRequest(oxyUserId);
      if (ok) {
        toast.success(t('roommates.profileDetail.requestSentTitle'), {
          description: t('roommates.profileDetail.requestSentBody'),
        });
      } else {
        toast.error(t('roommates.profileDetail.requestFailedTitle'), {
          description: t('roommates.profileDetail.requestFailedBody'),
        });
      }
    } finally {
      setIsSending(false);
    }
  };

  const renderBody = () => {
    if (profileQuery.isLoading) {
      return (
        <View style={styles.centered}>
          <Loading variant="spinner" />
        </View>
      );
    }

    if (profileQuery.isError || !profile || !info) {
      return (
        <ErrorState
          title={t('roommates.profileDetail.loadError')}
          description={t('roommates.profileDetail.loadErrorDescription')}
          onRetry={() => profileQuery.refetch()}
        />
      );
    }

    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Card variant="outlined" radius="radius-16" style={styles.headerCard}>
          <Avatar name={info.name} size={72} style={styles.avatar} />
          <SectionEyebrow>{t('roommates.profileDetail.title')}</SectionEyebrow>
          <H2 style={styles.name}>{info.name}</H2>
          {info.occupation ? (
            <BloomText style={styles.subtitle}>{info.occupation}</BloomText>
          ) : null}
          {info.location ? (
            <View style={styles.metaRow}>
              <RiMapPinLine width={16} height={16} fill={theme.colors.textSecondary} />
              <BloomText style={styles.metaText}>{info.location}</BloomText>
            </View>
          ) : null}
          {!isOwnProfile ? (
            <View style={styles.followRow}>
              <FollowButton userId={oxyUserId} size="medium" />
            </View>
          ) : null}
          {(followerCount != null || followingCount != null) && (
            <View style={styles.statsRow}>
              {followerCount != null ? (
                <BloomText style={styles.statText}>
                  {t('roommates.profileDetail.followers', { count: followerCount })}
                </BloomText>
              ) : null}
              {followingCount != null ? (
                <BloomText style={styles.statText}>
                  {t('roommates.profileDetail.following', { count: followingCount })}
                </BloomText>
              ) : null}
            </View>
          )}
        </Card>

        {info.bio ? (
          <Card variant="outlined" radius="radius-16" style={styles.card}>
            <H3 style={styles.cardTitle}>{t('roommates.profileDetail.about')}</H3>
            <BloomText style={styles.bodyText}>{info.bio}</BloomText>
          </Card>
        ) : null}

        <Card variant="outlined" radius="radius-16" style={styles.card}>
          <H3 style={styles.cardTitle}>{t('roommates.profileDetail.preferencesTitle')}</H3>
          <View style={styles.detailRow}>
            <BloomText style={styles.detailLabel}>{t('roommates.profileDetail.budget')}</BloomText>
            <BloomText style={styles.detailValue}>
              {info.budget.max > 0
                ? `${info.budget.currency} ${info.budget.min}–${info.budget.max}/mo`
                : t('roommates.profileDetail.notSpecified')}
            </BloomText>
          </View>
          <View style={styles.detailRow}>
            <BloomText style={styles.detailLabel}>{t('roommates.profileDetail.moveIn')}</BloomText>
            <BloomText style={styles.detailValue}>{info.moveInDate}</BloomText>
          </View>
          <View style={styles.detailRow}>
            <BloomText style={styles.detailLabel}>{t('roommates.profileDetail.leaseLength')}</BloomText>
            <BloomText style={styles.detailValue}>{info.duration}</BloomText>
          </View>
        </Card>

        <Card variant="outlined" radius="radius-16" style={styles.card}>
          <H3 style={styles.cardTitle}>{t('roommates.profileDetail.trust')}</H3>
          <View style={styles.badgeRow}>
            <TrustBadge label={t('roommates.profileDetail.verified')} active={info.isVerified} />
            <TrustBadge label={t('roommates.profileDetail.references')} active={info.hasReferences} />
            <TrustBadge label={t('roommates.profileDetail.rentalHistory')} active={info.rentalHistory} />
          </View>
        </Card>

        <Button
          variant="primary"
          size="large"
          onPress={handleSendRequest}
          loading={isSending}
          disabled={isSending}
          style={styles.sendButton}
        >
          {isSending ? t('roommates.profileDetail.sending') : t('roommates.profileDetail.sendRequest')}
        </Button>
      </ScrollView>
    );
  };

  return (
    <View style={styles.root}>
      <Header
        options={{
          title: t('roommates.profileDetail.title'),
          showBackButton: true,
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        {renderBody()}
      </SafeAreaView>
    </View>
  );
}

/** A trust signal: a success-tinted chip when present, a quiet one when not. */
const TrustBadge: React.FC<{ label: string; active: boolean }> = ({ label, active }) => {
  const theme = useTheme();
  const Icon = active ? RiCheckboxCircleFill : RiCheckboxBlankCircleLine;
  return (
    <Chip
      size="small"
      variant="subtle"
      color={active ? 'success' : 'default'}
      startIcon={
        <Icon
          width={14}
          height={14}
          fill={active ? theme.colors.success : theme.colors.textSecondary}
        />
      }
    >
      {label}
    </Chip>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['4xl'],
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  headerCard: {
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.xs,
  },
  avatar: {
    marginBottom: spacing.sm,
  },
  name: {
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  metaText: {
    fontSize: 13,
    color: colors.muted,
  },
  followRow: {
    marginTop: spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  statText: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: '600',
  },
  card: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: {
    letterSpacing: -0.3,
    marginBottom: spacing.xs,
  },
  bodyText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_2,
    lineHeight: 20,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  detailLabel: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sendButton: {
    alignSelf: 'stretch',
  },
});
