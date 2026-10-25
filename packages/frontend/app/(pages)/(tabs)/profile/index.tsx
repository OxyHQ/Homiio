import type React from 'react';
import { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { toast } from '@oxy.so/bloom/toast';
import { RiArrowLeftRightLine } from '@oxy.so/bloom/icons/RiArrowLeftRightLine';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons/RiArrowRightSLine';
import { RiBookmarkLine } from '@oxy.so/bloom/icons/RiBookmarkLine';
import { RiCoinsLine } from '@oxy.so/bloom/icons/RiCoinsLine';
import { RiFileTextLine } from '@oxy.so/bloom/icons/RiFileTextLine';
import { RiHotelBedLine } from '@oxy.so/bloom/icons/RiHotelBedLine';
import { RiLogoutBoxRLine } from '@oxy.so/bloom/icons/RiLogoutBoxRLine';
import { RiSettings3Line } from '@oxy.so/bloom/icons/RiSettings3Line';
import { RiStarLine } from '@oxy.so/bloom/icons/RiStarLine';
import { useTheme } from '@oxy.so/bloom/theme';

import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Badge } from '@oxy.so/bloom/badge';
import { Button } from '@oxy.so/bloom/button';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';
import { H1, H2, Text as BloomText } from '@oxy.so/bloom/typography';
import { useOxy } from '@oxy.so/services/ui/client';
import { TenantApplicationStatus } from '@homiio/shared-types';

import { SettingsRowIcon } from '@/components/profile/SettingsRowIcon';
import { Card } from '@oxy.so/bloom/card';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { confirm } from '@oxy.so/bloom/surfaces';
import { useProfileQuery } from '@/hooks/query/useProfiles';
import { useMyApplications } from '@/hooks/useApplicationQueries';
import { useReservationsQuery } from '@/hooks/useReservationQueries';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { spacing } from '@/constants/styles';
import { logger } from '@/utils/logger';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { logout, user } = useOxy();

  const profileQuery = useProfileQuery();
  const applicationsQuery = useMyApplications();
  const reservationsQuery = useReservationsQuery({ limit: 200 });
  const { savedProperties } = useSavedPropertiesContext();

  const profile = profileQuery.data ?? null;
  const isLoading = profileQuery.isLoading;
  const isError = profileQuery.isError;

  const totalApplications = applicationsQuery.data?.data?.length ?? 0;
  const approvedApplications = useMemo(
    () =>
      (applicationsQuery.data?.data ?? []).filter(
        (application) => application.status === TenantApplicationStatus.APPROVED,
      ).length,
    [applicationsQuery.data?.data],
  );
  const totalReservations = reservationsQuery.data?.items?.length ?? 0;
  const totalSaved = savedProperties.length;

  const handleLogout = useCallback(async () => {
    const ok = await confirm({
      title: t('settings.signOut'),
      description: t('settings.signOutMessage'),
      confirmLabel: t('settings.signOut'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await logout();
      router.replace('/');
      toast.success(t('settings.signOutSuccess'));
    } catch (error: unknown) {
      logger.error('Failed to sign out:', error);
      toast.error(t('settings.signOutFailed'));
    }
  }, [logout, router, t]);

  const header = (
    <PageHeader
      title={t('profile.title')}
      titleAlign="center"
      leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
    />
  );

  if (isLoading) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView contentContainerStyle={styles.content}>
          <View style={styles.heroSkeleton}>
            <ListSkeleton rows={2} rowHeight={120} />
          </View>
          <View style={styles.groups}>
            <ListSkeleton rows={3} rowHeight={72} />
          </View>
        </ScreenScrollView>
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView contentContainerStyle={styles.centerWrap}>
          <ErrorState
            title={t('profile.loadFailed')}
            description={t('profile.loadFailedHint')}
            retryLabel={t('common.retry')}
            onRetry={() => profileQuery.refetch()}
          />
        </ScreenScrollView>
      </Screen>
    );
  }

  const displayName = user?.name?.displayName || user?.username || 'Your profile';
  const bio = profile?.personalProfile?.personalInfo?.bio;
  const avatarUri = profile?.personalProfile?.personalInfo?.avatar;
  const verification = profile?.personalProfile?.verification;
  const verifiedBadges: { label: string; key: string }[] = [];
  if (verification?.identity) verifiedBadges.push({ label: 'ID verified', key: 'identity' });
  if (verification?.income) verifiedBadges.push({ label: 'Income verified', key: 'income' });
  if (verification?.references)
    verifiedBadges.push({ label: 'References verified', key: 'references' });
  if (verification?.background)
    verifiedBadges.push({ label: 'Background verified', key: 'background' });

  return (
    <Screen documentScroll header={header}>
      <ScreenScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroWrap}>
          <View style={styles.heroContent}>
            <View style={styles.heroRow}>
              <Avatar size={88} shape="squircle" uri={avatarUri} name={displayName} />
              <View style={styles.heroBody}>
                <H1 className="text-2xl font-bold text-foreground">{displayName}</H1>
                {user?.username ? (
                  <BloomText className="text-sm text-muted-foreground">
                    {`@${user.username}`}
                  </BloomText>
                ) : null}
                {bio ? (
                  <BloomText className="text-sm text-muted-foreground" numberOfLines={3}>
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
                    size="sm"
                  />
                ))}
              </View>
            ) : null}

            <View style={styles.heroActions}>
              <Button
                size="md"
                onPress={() => router.push('/profile/edit')}
                tone="neutral"
                appearance="outline"
              >
                {t('profile.actions.editProfile')}
              </Button>
            </View>
          </View>
        </View>

        <View style={styles.statsWrap}>
          <StatTile
            label={t('profile.stats.saved')}
            value={totalSaved}
            onPress={() => router.push('/saved')}
          />
          <StatTile
            label={t('profile.stats.applications')}
            value={totalApplications}
            description={
              approvedApplications > 0
                ? t('profile.stats.applicationsApproved', { count: approvedApplications })
                : undefined
            }
            onPress={() => router.push('/applications')}
          />
          <StatTile
            label={t('profile.stats.stays')}
            value={totalReservations}
            onPress={() => router.push('/stays')}
          />
        </View>

        <View style={styles.groups}>
          <SettingsListGroup title={t('profile.sections.activity')}>
            <SettingsListItem
              icon={<SettingsRowIcon icon={RiBookmarkLine} />}
              title={t('saved.header')}
              value={String(totalSaved)}
              onPress={() => router.push('/saved')}
            />
            <SettingsListItem
              icon={<SettingsRowIcon icon={RiFileTextLine} />}
              title={t('profile.applications')}
              value={String(totalApplications)}
              onPress={() => router.push('/applications')}
            />
            <SettingsListItem
              icon={<SettingsRowIcon icon={RiHotelBedLine} />}
              title={t('profile.stays')}
              value={String(totalReservations)}
              onPress={() => router.push('/stays')}
            />
            <SettingsListItem
              icon={<SettingsRowIcon icon={RiArrowLeftRightLine} />}
              title={t('profile.exchanges')}
              description={t('profile.exchangesDescription')}
              onPress={() => router.push('/exchange/requests')}
            />
          </SettingsListGroup>

          <SettingsListGroup title={t('agent.menu.section')}>
            <SettingsListItem
              icon={<SettingsRowIcon icon={RiCoinsLine} />}
              title={t('agent.menu.title')}
              description={t('agent.menu.description')}
              onPress={() => router.push('/agent')}
            />
          </SettingsListGroup>

          <SettingsListGroup title={t('profile.sections.account')}>
            <SettingsListItem
              icon={<SettingsRowIcon icon={RiStarLine} />}
              title={t('profile.subscriptions')}
              description={t('profile.subscriptionsDescription')}
              onPress={() => router.push('/profile/subscriptions')}
            />
            <SettingsListItem
              icon={<SettingsRowIcon icon={RiSettings3Line} />}
              title={t('settings.title')}
              onPress={() => router.push('/settings')}
            />
          </SettingsListGroup>

          <SettingsListGroup>
            <SettingsListItem
              icon={<SettingsRowIcon icon={RiLogoutBoxRLine} destructive />}
              title={t('settings.signOut')}
              destructive
              onPress={() => void handleLogout()}
            />
          </SettingsListGroup>
        </View>
      </ScreenScrollView>
    </Screen>
  );
}

interface StatTileProps {
  label: string;
  value: number;
  description?: string;
  onPress?: () => void;
}

const StatTile: React.FC<StatTileProps> = ({ label, value, description, onPress }) => {
  const { colors } = useTheme();
  return (
    <View style={styles.statTile}>
      <Card
        radius="radius-16"
        className="p-4"
        onPress={onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityLabel={onPress ? `${label}: ${value}. Open ${label.toLowerCase()}` : undefined}
        appearance="outline"
      >
        <H2 style={styles.statValue}>{value}</H2>
        <BloomText className="text-muted-foreground" style={styles.statLabel}>
          {label}
        </BloomText>
        {description ? (
          <BloomText className="text-muted-foreground" style={styles.statDescription}>
            {description}
          </BloomText>
        ) : null}
        {onPress ? (
          <View style={styles.statLink}>
            <BloomText
              className="text-primary-text"
              style={styles.statLinkText}
            >{`View ${label.toLowerCase()}`}</BloomText>
            <RiArrowRightSLine width={14} height={14} fill={colors.textSecondary} />
          </View>
        ) : null}
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  centerWrap: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['2xl'],
  },
  heroSkeleton: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroWrap: {
    marginBottom: spacing.lg,
  },
  // ONE horizontal padding + ONE uniform vertical gap between the identity
  // row, badges, and action.
  heroContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  // Top-align the name/handle/bio to the avatar's top edge (not its mid-height).
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.lg,
  },
  heroBody: {
    flex: 1,
    gap: spacing.xs,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  heroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  statTile: {
    flex: 1,
    minWidth: 100,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  statDescription: {
    fontSize: 12,
    marginTop: spacing.xs,
  },
  statLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  statLinkText: {
    fontSize: 12,
    fontWeight: '600',
  },
  // Bloom 2's SettingsListGroup draws no horizontal inset of its own, so the
  // screen supplies the gutter.
  groups: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['2xl'],
  },
});
