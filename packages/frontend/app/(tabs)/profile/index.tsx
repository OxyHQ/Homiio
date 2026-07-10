/**
 * Profile — personal home for the signed-in tenant/host.
 * Identity/switching/trust via Oxy SDK; Homiio sidecar = RE data only.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { toast } from '@/lib/sonner';
import { Ionicons } from '@expo/vector-icons';
import { getNormalizedUserHandle } from '@oxyhq/core';

import { Avatar } from '@oxyhq/bloom/avatar';
import { Badge } from '@oxyhq/bloom/badge';
import { Button } from '@oxyhq/bloom/button';
import {
  SettingsListGroup,
  SettingsListItem,
} from '@oxyhq/bloom/settings-list';
import {
  H1,
  H2,
  Text as BloomText,
} from '@oxyhq/bloom/typography';
import { useAuth, useOxy } from '@oxyhq/services';
import { TenantApplicationStatus } from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { CardSurface } from '@/components/ui/CardSurface';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useProfileQuery } from '@/hooks/query/useProfiles';
import { useMyApplications } from '@/hooks/useApplicationQueries';
import { useReservationsQuery } from '@/hooks/useReservationQueries';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { colors } from '@/styles/colors';
import { spacing, tracker } from '@/constants/styles';
import { logger } from '@/utils/logger';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const RowIcon: React.FC<{ name: IoniconName; destructive?: boolean }> = ({
  name,
  destructive,
}) => (
  <Ionicons
    name={name}
    size={20}
    color={destructive ? colors.danger : colors.muted}
  />
);

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { logout, showBottomSheet, user } = useOxy();
  const { isAuthResolved } = useAuth();

  const profileQuery = useProfileQuery();
  const applicationsQuery = useMyApplications();
  const reservationsQuery = useReservationsQuery({ limit: 200 });
  const { savedProperties } = useSavedPropertiesContext();

  const [pendingLogout, setPendingLogout] = useState(false);
  const [busyLogout, setBusyLogout] = useState(false);

  const sidecarProfile = profileQuery.data ?? null;
  const isLoading = !isAuthResolved || profileQuery.isLoading;
  const isError = profileQuery.isError;

  const totalApplications = applicationsQuery.data?.data?.length ?? 0;
  const approvedApplications = useMemo(
    () =>
      (applicationsQuery.data?.data ?? []).filter(
        (application) =>
          application.status === TenantApplicationStatus.APPROVED,
      ).length,
    [applicationsQuery.data?.data],
  );
  const totalReservations = reservationsQuery.data?.items?.length ?? 0;
  const totalSaved = savedProperties.length;

  const handleLogout = useCallback(async () => {
    setBusyLogout(true);
    try {
      await logout();
      router.replace('/');
      toast.success(t('settings.signOutSuccess', 'Signed out'));
    } catch (error: unknown) {
      logger.error('Failed to sign out:', error);
      toast.error(t('settings.signOutFailed', 'Failed to sign out'));
    } finally {
      setBusyLogout(false);
      setPendingLogout(false);
    }
  }, [logout, router, t]);

  const header = (
    <Header
      options={{
        title: t('profile.title', 'Profile'),
      }}
    />
  );

  if (isLoading) {
    return (
      <View style={styles.root}>
        {header}
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.heroSkeleton}>
            <ListSkeleton rows={2} rowHeight={120} />
          </View>
          <ListSkeleton rows={3} rowHeight={72} />
        </ScrollView>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerWrap}>
          <ErrorState
            title={t('profile.loadFailed', 'Failed to load profile')}
            description={t('profile.loadFailedHint', 'Please try again later.')}
            retryLabel={t('common.retry', 'Retry')}
            onRetry={() => profileQuery.refetch()}
          />
        </View>
      </View>
    );
  }

  const handle = user ? getNormalizedUserHandle(user) : undefined;
  const displayName = user?.name?.displayName?.trim() || handle || t('profile.title', 'Profile');
  const bio = sidecarProfile?.personalProfile?.personalInfo?.bio
    ?? sidecarProfile?.agencyProfile?.description;
  const avatarSource = user?.avatar;
  const verification = sidecarProfile?.personalProfile?.verification;
  const verifiedBadges: { label: string; key: string }[] = [];
  if (verification?.identity) verifiedBadges.push({ label: 'ID verified', key: 'identity' });
  if (verification?.income) verifiedBadges.push({ label: 'Income verified', key: 'income' });
  if (verification?.references)
    verifiedBadges.push({ label: 'References verified', key: 'references' });
  if (verification?.background)
    verifiedBadges.push({ label: 'Background verified', key: 'background' });

  return (
    <View style={styles.root}>
      {header}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroWrap}>
          <CardSurface padding={spacing['2xl']}>
            <View style={styles.heroRow}>
              <Avatar
                size={88}
                shape="squircle"
                source={avatarSource}
                name={displayName}
              />
              <View style={styles.heroBody}>
                <H1 style={styles.heroName}>{displayName}</H1>
                <BloomText style={styles.heroSubtitle}>
                  {handle ? `@${handle}` : ''}
                </BloomText>
                {bio ? (
                  <BloomText style={styles.heroBio} numberOfLines={3}>
                    {bio}
                  </BloomText>
                ) : null}
              </View>
            </View>

            {verifiedBadges.length > 0 ? (
              <View style={styles.badgesRow}>
                {verifiedBadges.map((badge) => (
                  <Badge
                    key={badge.key}
                    content={badge.label}
                    color="info"
                    variant="subtle"
                    size="small"
                  />
                ))}
              </View>
            ) : null}

            <View style={styles.heroActions}>
              <Button
                variant="secondary"
                size="medium"
                onPress={() => router.push('/profile/edit')}
              >
                {t('profile.edit', 'Edit profile')}
              </Button>
              <Button
                variant="ghost"
                size="medium"
                onPress={() => showBottomSheet?.('TrustCenter')}
              >
                {t('profile.trustCenter', 'Trust center')}
              </Button>
            </View>
          </CardSurface>
        </View>

        <View style={styles.statsWrap}>
          <StatTile
            label={t('profile.stats.saved', 'Saved')}
            value={totalSaved}
            onPress={() => router.push('/saved')}
          />
          <StatTile
            label={t('profile.stats.applications', 'Applications')}
            value={totalApplications}
            description={
              approvedApplications > 0
                ? t('profile.stats.applicationsApproved', '{{count}} approved', {
                    count: approvedApplications,
                  })
                : undefined
            }
            onPress={() => router.push('/applications')}
          />
          <StatTile
            label={t('profile.stats.stays', 'Stays')}
            value={totalReservations}
            onPress={() => router.push('/stays')}
          />
        </View>

        <SettingsListGroup title={t('profile.sections.activity', 'Activity')}>
          <SettingsListItem
            icon={<RowIcon name="bookmark-outline" />}
            title={t('saved.header', 'Saved')}
            value={String(totalSaved)}
            onPress={() => router.push('/saved')}
          />
          <SettingsListItem
            icon={<RowIcon name="document-text-outline" />}
            title={t('profile.applications', 'My applications')}
            value={String(totalApplications)}
            onPress={() => router.push('/applications')}
          />
          <SettingsListItem
            icon={<RowIcon name="bed-outline" />}
            title={t('profile.stays', 'Stays')}
            value={String(totalReservations)}
            onPress={() => router.push('/stays')}
          />
          <SettingsListItem
            icon={<RowIcon name="swap-horizontal" />}
            title={t('profile.exchanges', 'Exchanges')}
            description={t(
              'profile.exchangesDescription',
              'Your home swaps and hosting requests.',
            )}
            onPress={() => router.push('/exchange/requests')}
          />
        </SettingsListGroup>

        <SettingsListGroup title={t('agent.menu.section', 'Earn')}>
          <SettingsListItem
            icon={<RowIcon name="cash-outline" />}
            title={t('agent.menu.title', 'Earn with Homiio')}
            description={t(
              'agent.menu.description',
              'Bring homes to Homiio and earn when they rent or sell.',
            )}
            onPress={() => router.push('/agent')}
          />
        </SettingsListGroup>

        <SettingsListGroup title={t('profile.sections.account', 'Account')}>
          <SettingsListItem
            icon={<RowIcon name="person-circle-outline" />}
            title={t('settings.manageAccount', 'Manage account')}
            description={t('settings.manageAccountDescription', 'Profile, security, and connected apps')}
            onPress={() => showBottomSheet?.('ManageAccount')}
          />
          <SettingsListItem
            icon={<RowIcon name="star-outline" />}
            title={t('profile.subscriptions', 'Subscriptions')}
            description={t(
              'profile.subscriptionsDescription',
              'Manage Homiio Plus or buy one-time file analysis.',
            )}
            onPress={() => router.push('/profile/subscriptions')}
          />
          <SettingsListItem
            icon={<RowIcon name="settings-outline" />}
            title={t('settings.title', 'Settings')}
            onPress={() => router.push('/settings')}
          />
        </SettingsListGroup>

        <SettingsListGroup>
          <SettingsListItem
            icon={<RowIcon name="log-out" destructive />}
            title={t('settings.signOut', 'Sign out')}
            destructive
            onPress={() => setPendingLogout(true)}
          />
        </SettingsListGroup>

        <View style={styles.bottomPadding} />
      </ScrollView>

      <ConfirmDialog
        visible={pendingLogout}
        title={t('settings.signOut', 'Sign out')}
        message={t('settings.signOutMessage', 'Are you sure you want to sign out?')}
        confirmLabel={t('settings.signOut', 'Sign out')}
        confirmDestructive
        loading={busyLogout}
        onConfirm={handleLogout}
        onCancel={() => setPendingLogout(false)}
      />
    </View>
  );
}

interface StatTileProps {
  label: string;
  value: number;
  description?: string;
  onPress?: () => void;
}

const StatTile: React.FC<StatTileProps> = ({ label, value, description, onPress }) => {
  const [pressed, setPressed] = useState(false);
  const body = (
    <>
      <H2 style={styles.statValue}>{value}</H2>
      <BloomText style={styles.statLabel}>{label}</BloomText>
      {description ? (
        <BloomText style={styles.statDescription}>{description}</BloomText>
      ) : null}
      {onPress ? (
        <View style={styles.statLink}>
          <BloomText style={styles.statLinkText}>
            {`View ${label.toLowerCase()}`}
          </BloomText>
          <Ionicons
            name="chevron-forward"
            size={14}
            color={colors.primaryColor}
          />
        </View>
      ) : null}
    </>
  );

  return (
    <View style={styles.statTile}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${value}. Open ${label.toLowerCase()}`}
          style={pressed ? styles.statTilePressed : null}
        >
          <CardSurface padding={spacing.lg}>{body}</CardSurface>
        </Pressable>
      ) : (
        <CardSurface padding={spacing.lg}>{body}</CardSurface>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['2xl'],
  },
  heroSkeleton: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroWrap: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginBottom: spacing.md,
  },
  heroBody: {
    flex: 1,
    gap: spacing.xs,
  },
  heroName: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: tracker.tight,
  },
  heroSubtitle: {
    fontSize: 13,
    color: colors.muted,
  },
  heroBio: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  heroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statsWrap: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  statTile: {
    flex: 1,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: tracker.tight,
  },
  statLabel: {
    fontSize: 12,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: tracker.eyebrow,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  statDescription: {
    fontSize: 11,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  statLink: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primaryColor,
  },
  statTilePressed: {
    opacity: 0.85,
  },
  bottomPadding: {
    height: spacing['4xl'],
  },
});
