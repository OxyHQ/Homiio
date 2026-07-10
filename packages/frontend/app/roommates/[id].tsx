/**
 * Roommate profile detail — `/roommates/:id`.
 *
 * Shows a single roommate candidate's public profile (display name, bio,
 * verification, matching preferences) and lets the viewer send a roommate
 * request. Data comes from the authenticated profile-by-id read; the roommate
 * matching preferences and trust signals are derived through
 * `roommateService.getProfileDisplayInfo` (no invented values).
 */
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import { Loading } from '@oxyhq/bloom/loading';
import { H2, H3, Text as BloomText } from '@oxyhq/bloom/typography';

import { Header } from '@/components/Header';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { useRoommate } from '@/hooks/useRoommate';
import profileService from '@/services/profileService';
import { roommateService } from '@/services/roommateService';
import { radius, spacing, withShadow } from '@/constants/styles';
import { colors } from '@/styles/colors';

export default function RoommateProfilePage() {
  const params = useLocalSearchParams<{ id: string }>();
  const profileId = String(params.id);
  const { sendRequest } = useRoommate();
  const [isSending, setIsSending] = useState(false);

  const profileQuery = useQuery({
    queryKey: ['roommates', 'profile', profileId],
    queryFn: async () => profileService.getProfileById(profileId),
    enabled: Boolean(profileId),
    staleTime: 1000 * 30,
  });

  const profile = profileQuery.data;
  const info = profile ? roommateService.getProfileDisplayInfo(profile) : null;

  const handleSendRequest = async () => {
    setIsSending(true);
    try {
      const ok = await sendRequest(profileId);
      Alert.alert(
        ok ? 'Request sent' : 'Could not send request',
        ok
          ? 'Your roommate request was sent.'
          : 'We could not send your request. Please try again.',
      );
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
          title="Couldn't load profile"
          description="We couldn't load this roommate profile. Please try again."
          onRetry={() => profileQuery.refetch()}
        />
      );
    }

    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerCard}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={36} color={colors.COLOR_BLACK_LIGHT_4} />
          </View>
          <SectionEyebrow>Roommate</SectionEyebrow>
          <H2 style={styles.name}>{info.name}</H2>
          {info.occupation ? (
            <BloomText style={styles.subtitle}>{info.occupation}</BloomText>
          ) : null}
          {info.location ? (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={16} color={colors.muted} />
              <BloomText style={styles.metaText}>{info.location}</BloomText>
            </View>
          ) : null}
        </View>

        {info.bio ? (
          <View style={styles.card}>
            <H3 style={styles.cardTitle}>About</H3>
            <BloomText style={styles.bodyText}>{info.bio}</BloomText>
          </View>
        ) : null}

        <View style={styles.card}>
          <H3 style={styles.cardTitle}>Roommate preferences</H3>
          <View style={styles.detailRow}>
            <BloomText style={styles.detailLabel}>Budget</BloomText>
            <BloomText style={styles.detailValue}>
              {info.budget.max > 0
                ? `${info.budget.currency} ${info.budget.min}–${info.budget.max}/mo`
                : 'Not specified'}
            </BloomText>
          </View>
          <View style={styles.detailRow}>
            <BloomText style={styles.detailLabel}>Move-in</BloomText>
            <BloomText style={styles.detailValue}>{info.moveInDate}</BloomText>
          </View>
          <View style={styles.detailRow}>
            <BloomText style={styles.detailLabel}>Lease length</BloomText>
            <BloomText style={styles.detailValue}>{info.duration}</BloomText>
          </View>
        </View>

        <View style={styles.card}>
          <H3 style={styles.cardTitle}>Trust</H3>
          <View style={styles.badgeRow}>
            <TrustBadge label="Verified" active={info.isVerified} />
            <TrustBadge label="References" active={info.hasReferences} />
            <TrustBadge label="Rental history" active={info.rentalHistory} />
          </View>
        </View>

        <Button
          variant="primary"
          size="large"
          onPress={handleSendRequest}
          disabled={isSending}
          style={styles.sendButton}
        >
          {isSending ? 'Sending…' : 'Send roommate request'}
        </Button>
      </ScrollView>
    );
  };

  return (
    <View style={styles.root}>
      <Header
        options={{
          title: 'Roommate',
          showBackButton: true,
          titlePosition: 'center',
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        {renderBody()}
      </SafeAreaView>
    </View>
  );
}

const TrustBadge: React.FC<{ label: string; active: boolean }> = ({ label, active }) => (
  <View style={[styles.badge, active ? styles.badgeActive : styles.badgeInactive]}>
    <Ionicons
      name={active ? 'checkmark-circle' : 'ellipse-outline'}
      size={14}
      color={active ? colors.success : colors.muted}
    />
    <BloomText style={[styles.badgeText, active ? styles.badgeTextActive : undefined]}>
      {label}
    </BloomText>
  </View>
);

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
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.xs,
    ...withShadow('sm'),
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.mutedSubtle,
    alignItems: 'center',
    justifyContent: 'center',
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
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...withShadow('sm'),
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
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  badgeActive: {
    backgroundColor: colors.successSubtle,
  },
  badgeInactive: {
    backgroundColor: colors.mutedSubtle,
  },
  badgeText: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: '600',
  },
  badgeTextActive: {
    color: colors.success,
  },
  sendButton: {
    alignSelf: 'stretch',
  },
});
