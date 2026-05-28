/**
 * Landlord applicant inbox.
 *
 * Lists tenant applications the current landlord has received, grouped by
 * property. Supports filtering by status (chips) and searching by applicant
 * name (Bloom SearchInput). Route gated by useHostStatus — non-hosts can
 * still hit the URL directly but get a host-only empty state.
 */
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueries } from '@tanstack/react-query';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import { Button } from '@oxyhq/bloom/button';
import { Chip } from '@oxyhq/bloom/chip';
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
import { useHostStatus } from '@/hooks/useHostStatus';
import { useLandlordApplications } from '@/hooks/useApplicationQueries';
import { useProperty } from '@/hooks';
import profileService from '@/services/profileService';
import { getPropertyTitle } from '@/utils/propertyUtils';
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
  switch (profile.profileType) {
    case 'personal': {
      const bio = profile.personalProfile?.personalInfo?.bio;
      return bio?.trim() || profile.oxyUserId || 'Applicant';
    }
    case 'agency':
      return (
        profile.agencyProfile?.legalCompanyName?.trim() ||
        profile.oxyUserId ||
        'Agency applicant'
      );
    case 'business':
      return (
        profile.businessProfile?.legalCompanyName?.trim() ||
        profile.oxyUserId ||
        'Business applicant'
      );
    case 'cooperative':
      return (
        profile.cooperativeProfile?.legalName?.trim() ||
        profile.oxyUserId ||
        'Cooperative applicant'
      );
    default:
      return profile.oxyUserId || 'Applicant';
  }
};

const getProfileAvatarUrl = (
  profile: Profile | null | undefined,
): string | undefined => {
  if (!profile) return undefined;
  if (profile.oxyUserId) {
    return `https://cdn.oxy.so/avatars/${profile.oxyUserId}`;
  }
  return profile.personalProfile?.personalInfo?.avatar || profile.avatar;
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
}

const PropertyGroupBlock: React.FC<PropertyGroupBlockProps> = ({
  propertyId,
  applications,
  applicants,
}) => {
  const { property } = useProperty(propertyId);
  const title = property ? getPropertyTitle(property) : 'Property';
  return (
    <View style={styles.groupBlock}>
      <H3 style={styles.groupTitle}>{title}</H3>
      {applications.map((application) => {
        const applicantId = String(application.applicantProfileId);
        const applicant = applicants.get(applicantId) ?? null;
        return (
          <ApplicationCard
            key={application.id}
            application={application}
            variant="landlord"
            href={`/landlord/applications/${application.id}`}
            applicantName={getProfileDisplayName(applicant)}
            applicantAvatarUrl={getProfileAvatarUrl(applicant)}
          />
        );
      })}
    </View>
  );
};

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
      set.add(String(application.applicantProfileId));
    }
    return Array.from(set);
  }, [items]);

  const applicantQueries = useQueries({
    queries: uniqueApplicantIds.map((profileId) => ({
      queryKey: ['profile-by-id', profileId] as const,
      queryFn: async () => profileService.getProfileById(profileId),
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

  const filteredItems = useMemo<TenantApplication[]>(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    if (!trimmed) return items;
    return items.filter((application) => {
      const applicant = applicantMap.get(String(application.applicantProfileId));
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
            titlePosition: 'center',
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
            titlePosition: 'center',
          }}
        />
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primaryColor} />
        </View>
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
            titlePosition: 'center',
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
          titlePosition: 'center',
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
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

          {applicationsQuery.isPending ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.primaryColor} />
            </View>
          ) : null}

          {applicationsQuery.isError ? (
            <View style={styles.errorWrap}>
              <BloomText style={styles.errorTitle}>
                Couldn&apos;t load applicants
              </BloomText>
              <BloomText style={styles.errorSubtitle}>
                {applicationsQuery.error?.message ?? 'Please try again.'}
              </BloomText>
              <Button
                variant="primary"
                size="medium"
                onPress={() => applicationsQuery.refetch()}
              >
                Retry
              </Button>
            </View>
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
    backgroundColor: colors.primaryLight,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  loadingWrap: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorWrap: {
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  errorSubtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  groupBlock: {
    gap: 4,
    marginBottom: 4,
  },
  groupTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
});
