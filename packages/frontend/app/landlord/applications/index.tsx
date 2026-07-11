/**
 * Landlord applicant inbox.
 *
 * Stream Q polish:
 *   - Bloom Chip filter row + Bloom SearchInput.
 *   - Shared EmptyState / ErrorState components.
 *   - Loading uses Skeleton.Box rows.
 *   - All copy via Bloom Typography. Sections use SectionEyebrow + H3.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueries } from '@tanstack/react-query';
import { H2, H3, Text as BloomText } from '@oxyhq/bloom/typography';
import { Chip } from '@oxyhq/bloom/chip';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { SearchInput } from '@oxyhq/bloom/search-input';
import { useOxy, showSignInModal } from '@oxyhq/services';
import {
  Profile,
  TenantApplication,
  TenantApplicationStatus,
} from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { ApplicationCard } from '@/components/ApplicationCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { useHostStatus } from '@/hooks/useHostStatus';
import { useLandlordApplications } from '@/hooks/useApplicationQueries';
import { useProperty } from '@/hooks';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';
import profileService from '@/services/profileService';
import { getPropertyTitle } from '@/utils/propertyUtils';
import { radius, spacing } from '@/constants/styles';
import { colors } from '@/styles/colors';

type StatusFilter = 'all' | TenantApplicationStatus;

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: TenantApplicationStatus.SUBMITTED, label: 'Submitted' },
  { id: TenantApplicationStatus.REVIEWING, label: 'Reviewing' },
  { id: TenantApplicationStatus.APPROVED, label: 'Approved' },
  { id: TenantApplicationStatus.REJECTED, label: 'Rejected' },
  { id: TenantApplicationStatus.WITHDRAWN, label: 'Withdrawn' },
];

const getProfileDisplayName = (profile: Profile | null | undefined): string => {
  if (!profile) return 'Applicant';
  const bio = profile.personalProfile?.personalInfo?.bio;
  return bio?.trim() || profile.oxyUserId || 'Applicant';
};

/**
 * The applicant avatar to render: prefer the Oxy avatar file id (resolved to a
 * URL downstream by the registered ImageResolver), else a profile-local custom
 * avatar. `getAvatarFileId` comes from {@link useOxyAvatars} (batched lookup).
 */
const getProfileAvatarFileId = (
  profile: Profile | null | undefined,
  getAvatarFileId: (oxyUserId: string | undefined | null) => string | undefined,
): string | undefined => {
  if (!profile) return undefined;
  return (
    getAvatarFileId(profile.oxyUserId) ||
    profile.personalProfile?.personalInfo?.avatar ||
    profile.avatar
  );
};

interface PropertyGroup {
  propertyId: string;
  items: TenantApplication[];
}

const groupByProperty = (items: TenantApplication[]): PropertyGroup[] => {
  const buckets = new Map<string, TenantApplication[]>();
  for (const application of items) {
    const key = String(application.propertyId);
    const list = buckets.get(key) ?? [];
    list.push(application);
    buckets.set(key, list);
  }
  return Array.from(buckets.entries()).map(([propertyId, list]) => ({
    propertyId,
    items: list,
  }));
};

interface PropertyGroupBlockProps {
  propertyId: string;
  applications: TenantApplication[];
  applicants: Map<string, Profile | null>;
  getAvatarFileId: (oxyUserId: string | undefined | null) => string | undefined;
}

const PropertyGroupBlock: React.FC<PropertyGroupBlockProps> = ({
  propertyId,
  applications,
  applicants,
  getAvatarFileId,
}) => {
  const { property } = useProperty(propertyId);
  const title = property ? getPropertyTitle(property) : 'Property';
  return (
    <View style={styles.groupBlock}>
      <View style={styles.groupHeader}>
        <SectionEyebrow>Property</SectionEyebrow>
        <H3 style={styles.groupTitle}>{title}</H3>
      </View>
      {applications.map((application) => {
        const applicantId = String(application.applicantOxyUserId);
        const applicant = applicants.get(applicantId) ?? null;
        return (
          <ApplicationCard
            key={application.id}
            application={application}
            variant="landlord"
            href={`/landlord/applications/${application.id}`}
            applicantName={getProfileDisplayName(applicant)}
            applicantAvatarFileId={getProfileAvatarFileId(applicant, getAvatarFileId)}
          />
        );
      })}
    </View>
  );
};

const ApplicationsSkeleton: React.FC = () => (
  <View style={styles.skeletonGroup}>
    {Array.from({ length: 3 }).map((_, idx) => (
      <View key={idx} style={styles.skeletonCard}>
        <Skeleton.Box width={84} height={84} borderRadius={radius.md} />
        <View style={styles.skeletonBody}>
          <Skeleton.Text style={{ width: 180, lineHeight: 18 }} />
          <Skeleton.Text style={{ width: 220, lineHeight: 14 }} />
          <Skeleton.Text style={{ width: 140, lineHeight: 14 }} />
        </View>
      </View>
    ))}
  </View>
);

export default function LandlordApplicationsScreen() {
  const { isAuthenticated } = useOxy();
  const { isHost, isLoading: hostLoading } = useHostStatus();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const applicationsQuery = useLandlordApplications(
    statusFilter === 'all' ? undefined : statusFilter,
  );

  const items = useMemo<TenantApplication[]>(
    () => applicationsQuery.data?.data ?? [],
    [applicationsQuery.data?.data],
  );

  // Resolve applicant profiles in parallel so we can search/display by name.
  const uniqueApplicantIds = useMemo(() => {
    const set = new Set<string>();
    for (const application of items) {
      set.add(String(application.applicantOxyUserId));
    }
    return Array.from(set);
  }, [items]);

  const applicantQueries = useQueries({
    queries: uniqueApplicantIds.map((oxyUserId) => ({
      queryKey: ['profile-by-oxy-user-id', oxyUserId] as const,
      queryFn: async () => profileService.getProfileByOxyUserId(oxyUserId),
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
    })),
  });

  const applicantMap = useMemo<Map<string, Profile | null>>(() => {
    const map = new Map<string, Profile | null>();
    uniqueApplicantIds.forEach((profileId, index) => {
      map.set(profileId, applicantQueries[index]?.data ?? null);
    });
    return map;
  }, [uniqueApplicantIds, applicantQueries]);

  // Batch-resolve every applicant's Oxy avatar in a single request (no N+1).
  const applicantOxyUserIds = useMemo(
    () =>
      Array.from(applicantMap.values())
        .map((profile) => profile?.oxyUserId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    [applicantMap],
  );
  const { getAvatarFileId } = useOxyAvatars(applicantOxyUserIds);

  const filteredItems = useMemo<TenantApplication[]>(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    if (!trimmed) return items;
    return items.filter((application) => {
      const applicant = applicantMap.get(String(application.applicantOxyUserId));
      const name = getProfileDisplayName(applicant).toLowerCase();
      return name.includes(trimmed);
    });
  }, [items, applicantMap, searchQuery]);

  const groups = useMemo(() => groupByProperty(filteredItems), [filteredItems]);

  if (!isAuthenticated) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: 'Applicant inbox',
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="people-outline"
              title="Sign in to review applicants"
              description="See who wants to rent your places, all in one place."
              actionText="Sign in"
              actionIcon="log-in-outline"
              onAction={() => showSignInModal()}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (hostLoading) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: 'Applicant inbox',
          }}
        />
        <ScrollView contentContainerStyle={styles.content}>
          <ApplicationsSkeleton />
        </ScrollView>
      </View>
    );
  }

  if (!isHost) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: 'Applicant inbox',
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="lock-closed-outline"
              title="Hosts only"
              description="List a property to start receiving tenant applications."
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Header
        options={{
          showBackButton: true,
          title: 'Applicant inbox',
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.titleBlock}>
            <SectionEyebrow>Inbox</SectionEyebrow>
            <H2 style={styles.title}>Applicants</H2>
            <BloomText style={styles.subtitle}>
              Review prospective tenants and decide on each application.
            </BloomText>
          </View>

          <SearchInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            onClearText={() => setSearchQuery('')}
            label="Search by applicant name"
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {FILTERS.map((entry) => {
              const isActive = statusFilter === entry.id;
              return (
                <Chip
                  key={entry.id}
                  onPress={() => setStatusFilter(entry.id)}
                  variant={isActive ? 'solid' : 'outlined'}
                  color={isActive ? 'primary' : 'default'}
                  selected={isActive}
                >
                  {entry.label}
                </Chip>
              );
            })}
          </ScrollView>

          {applicationsQuery.isPending ? <ApplicationsSkeleton /> : null}

          {applicationsQuery.isError ? (
            <ErrorState
              icon="cloud-offline-outline"
              title="Couldn't load applicants"
              description={
                applicationsQuery.error?.message ?? 'Please try again.'
              }
              onRetry={() => applicationsQuery.refetch()}
            />
          ) : null}

          {!applicationsQuery.isPending &&
          !applicationsQuery.isError &&
          groups.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="people-outline"
                title="No applicants yet"
                description="Applications from prospective tenants will show up here."
              />
            </View>
          ) : null}

          {groups.map((group) => (
            <PropertyGroupBlock
              key={group.propertyId}
              propertyId={group.propertyId}
              applications={group.items}
              applicants={applicantMap}
              getAvatarFileId={getAvatarFileId}
            />
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  titleBlock: {
    gap: spacing.xs,
  },
  title: {
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  groupBlock: {
    gap: spacing.sm,
  },
  groupHeader: {
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  groupTitle: {
    letterSpacing: -0.5,
  },
  skeletonGroup: {
    gap: spacing.md,
  },
  skeletonCard: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skeletonBody: {
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
});
