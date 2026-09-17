/**
 * Landlord applicant inbox.
 *
 * - Phones and narrow windows: Bloom Search + a Chip status filter row over
 *   `ApplicationCard`s grouped by property.
 * - Wide web (desktop breakpoint): a Bloom `DataTable` — sortable columns for
 *   applicant, income, move-in and submission date, a status filter and an
 *   applicant search in its toolbar, and per-row actions (open, and create the
 *   lease once approved — through `/contracts/new?application=<id>`, the one
 *   lease-create entry point).
 */
import React, { useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { H2, H3, Text as BloomText } from '@oxy.so/bloom/typography';
import { Chip } from '@oxy.so/bloom/chip';
import { Avatar } from '@oxy.so/bloom/avatar';
import { useTheme } from '@oxy.so/bloom/theme';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { Search } from '@oxy.so/bloom/search';
import {
  DataTable,
  DataTableFilter,
  DataTableRowActions,
  DataTableSearch,
  type DataTableColumn,
  type DataTableRowActionItem,
} from '@oxy.so/bloom/data-table';
import { RiArrowRightUpLine, RiEditLine } from '@oxy.so/bloom/icons';
import { useOxy, openAccountDialog } from '@oxy.so/services';
import {
  Profile,
  TenantApplication,
  TenantApplicationStatus,
  formatMoney,
} from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { PageScrollView } from '@/components/PageScrollView';
import { ApplicationCard } from '@/components/ApplicationCard';
import { ApplicationStatusBadge } from '@/components/ApplicationStatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { useHostStatus } from '@/hooks/useHostStatus';
import { useLandlordApplications } from '@/hooks/useApplicationQueries';
import { useProperty } from '@/hooks';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';
import { useIsDesktop } from '@/hooks/useOptimizedMediaQuery';
import profileService from '@/services/profileService';
import { getPropertyTitle } from '@/utils/propertyUtils';
import { useFormatting } from '@/utils/format';
import { formatLocalized } from '@/utils/dateLocale';
import { radius, spacing } from '@/constants/styles';

type StatusFilter = 'all' | TenantApplicationStatus;

/** A tenant's declared income has no currency field; it is quoted in euros. */
const APPLICATION_INCOME_CURRENCY = 'EUR';

const FILTERS: { id: StatusFilter; i18nKey: string }[] = [
  { id: 'all', i18nKey: 'applications.list.filterAll' },
  { id: TenantApplicationStatus.SUBMITTED, i18nKey: 'statusBadge.application.submitted' },
  { id: TenantApplicationStatus.REVIEWING, i18nKey: 'statusBadge.application.reviewing' },
  { id: TenantApplicationStatus.APPROVED, i18nKey: 'statusBadge.application.approved' },
  { id: TenantApplicationStatus.REJECTED, i18nKey: 'statusBadge.application.rejected' },
  { id: TenantApplicationStatus.WITHDRAWN, i18nKey: 'statusBadge.application.withdrawn' },
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

/** Table cell: the property title, resolved per row through the cached property query. */
const PropertyTitleCell: React.FC<{ propertyId: string }> = ({ propertyId }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const { property } = useProperty(propertyId);
  return (
    <BloomText numberOfLines={1} style={[styles.cellText, { color: theme.colors.textSecondary }]}>
      {property ? getPropertyTitle(property) : t('applications.card.propertyFallback')}
    </BloomText>
  );
};

interface ApplicantRow {
  application: TenantApplication;
  name: string;
  avatar: string | undefined;
}

interface ApplicantsTableProps {
  rows: ApplicantRow[];
  statusFilter: StatusFilter;
  onStatusFilterChange: (next: StatusFilter) => void;
  searchQuery: string;
  onSearchQueryChange: (next: string) => void;
}

const ApplicantsTable: React.FC<ApplicantsTableProps> = ({
  rows,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchQueryChange,
}) => {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const router = useRouter();

  const columns = useMemo<DataTableColumn<ApplicantRow>[]>(
    () => [
      {
        id: 'applicant',
        header: t('applications.card.applicantFallback'),
        basis: 220,
        accessor: (row) => row.name,
        cell: ({ row }) => (
          <View style={styles.applicantCell}>
            <Avatar size={28} name={row.name} source={row.avatar ?? null} variant="thumb" />
            <BloomText numberOfLines={1} style={[styles.cellText, styles.cellStrong]}>
              {row.name}
            </BloomText>
          </View>
        ),
      },
      {
        id: 'property',
        header: t('applications.card.propertyFallback'),
        basis: 220,
        cell: ({ row }) => <PropertyTitleCell propertyId={String(row.application.propertyId)} />,
      },
      {
        id: 'income',
        header: t('applications.field.monthlyIncome'),
        basis: 140,
        accessor: (row) => row.application.monthlyIncome,
        cell: ({ row }) => (
          <BloomText numberOfLines={1} style={styles.cellText}>
            {formatMoney(row.application.monthlyIncome, APPLICATION_INCOME_CURRENCY, locale)}
          </BloomText>
        ),
      },
      {
        id: 'employment',
        header: t('applications.field.employment'),
        basis: 140,
        accessor: (row) => row.application.employmentStatus,
        cell: ({ row }) => (
          <BloomText numberOfLines={1} style={styles.cellText}>
            {t(`profile.edit.options.employmentStatus.${row.application.employmentStatus}`)}
          </BloomText>
        ),
      },
      {
        id: 'moveIn',
        header: t('applications.card.moveIn'),
        basis: 120,
        accessor: (row) => new Date(row.application.moveInDate),
        cell: ({ row }) => (
          <BloomText numberOfLines={1} style={styles.cellText}>
            {formatLocalized(new Date(row.application.moveInDate), 'MMM d, yyyy')}
          </BloomText>
        ),
      },
      {
        id: 'submitted',
        header: t('statusBadge.application.submitted'),
        basis: 120,
        accessor: (row) => new Date(row.application.submittedAt),
        cell: ({ row }) => (
          <BloomText numberOfLines={1} style={styles.cellText}>
            {formatLocalized(new Date(row.application.submittedAt), 'MMM d, yyyy')}
          </BloomText>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        basis: 120,
        accessor: (row) => row.application.status,
        cell: ({ row }) => <ApplicationStatusBadge status={row.application.status} />,
      },
      {
        id: 'actions',
        header: '',
        width: 96,
        cell: ({ row }) => {
          const { application } = row;
          const actions: DataTableRowActionItem[] = [
            {
              icon: RiArrowRightUpLine,
              label: 'Open application',
              onPress: () => router.push(`/landlord/applications/${application.id}`),
            },
          ];
          if (application.status === TenantApplicationStatus.APPROVED) {
            actions.push({
              icon: RiEditLine,
              label: 'Create lease',
              onPress: () =>
                router.push({
                  pathname: '/contracts/new',
                  params: { application: application.id },
                }),
            });
          }
          return <DataTableRowActions name={row.name} actions={actions} />;
        },
      },
    ],
    [t, locale, router],
  );

  return (
    <DataTable
      accessibilityLabel="Applicants"
      rows={rows}
      columns={columns}
      getRowId={(row) => String(row.application.id)}
      title="Applicants"
      summary={String(rows.length)}
      defaultSort={{ columnId: 'submitted', direction: 'descending' }}
      pageSize={20}
      minWidth={1000}
      toolbar={
        <>
          <DataTableFilter
            label="Filter by status"
            value={statusFilter}
            onValueChange={(value) => onStatusFilterChange(value as StatusFilter)}
            options={FILTERS.map((entry) => ({ value: entry.id, label: t(entry.i18nKey) }))}
          />
          <DataTableSearch
            label="Search by applicant name"
            value={searchQuery}
            onChangeText={onSearchQueryChange}
          />
        </>
      }
      emptyState="Applications from prospective tenants will show up here."
    />
  );
};

const ApplicationsSkeleton: React.FC = () => {
  const theme = useTheme();
  return (
    <View style={styles.skeletonGroup}>
      {Array.from({ length: 3 }).map((_, idx) => (
        <View
          key={idx}
          style={[styles.skeletonCard, { borderColor: theme.colors.border }]}
        >
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
};

export default function LandlordApplicationsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { isAuthenticated } = useOxy();
  const { isHost, isLoading: hostLoading } = useHostStatus();
  const isDesktop = useIsDesktop();
  const showTable = Platform.OS === 'web' && isDesktop;
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

  const tableRows = useMemo<ApplicantRow[]>(
    () =>
      filteredItems.map((application) => {
        const applicant = applicantMap.get(String(application.applicantOxyUserId)) ?? null;
        return {
          application,
          name: getProfileDisplayName(applicant),
          avatar: getProfileAvatarFileId(applicant, getAvatarFileId),
        };
      }),
    [filteredItems, applicantMap, getAvatarFileId],
  );

  const rootStyle = [styles.root, { backgroundColor: theme.colors.background }];
  const header = (
    <Header
      options={{
        showBackButton: true,
        title: 'Applicant inbox',
      }}
    />
  );

  if (!isAuthenticated) {
    return (
      <View style={rootStyle}>
        {header}
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="people-outline"
              title="Sign in to review applicants"
              description="See who wants to rent your places, all in one place."
              actionText="Sign in"
              actionIcon="log-in-outline"
              onAction={() => openAccountDialog()}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (hostLoading) {
    return (
      <View style={rootStyle}>
        {header}
        <PageScrollView contentContainerStyle={styles.content}>
          <ApplicationsSkeleton />
        </PageScrollView>
      </View>
    );
  }

  if (!isHost) {
    return (
      <View style={rootStyle}>
        {header}
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

  const listReady = !applicationsQuery.isPending && !applicationsQuery.isError;

  return (
    <View style={rootStyle}>
      {header}
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <PageScrollView contentContainerStyle={styles.content}>
          <View style={styles.titleBlock}>
            <SectionEyebrow>Inbox</SectionEyebrow>
            <H2 style={styles.title}>Applicants</H2>
            <BloomText style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
              Review prospective tenants and decide on each application.
            </BloomText>
          </View>

          {!showTable ? (
            <>
              <Search
                value={searchQuery}
                onChangeText={setSearchQuery}
                onClearText={() => setSearchQuery('')}
                label="Search by applicant name"
              />

              <View style={styles.filterRow}>
                {FILTERS.map((entry) => (
                  <Chip
                    key={entry.id}
                    variant="outlined"
                    selected={statusFilter === entry.id}
                    onPress={() => setStatusFilter(entry.id)}
                  >
                    {t(entry.i18nKey)}
                  </Chip>
                ))}
              </View>
            </>
          ) : null}

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

          {listReady && showTable ? (
            <ApplicantsTable
              rows={tableRows}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
            />
          ) : null}

          {listReady && !showTable && groups.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="people-outline"
                title="No applicants yet"
                description="Applications from prospective tenants will show up here."
              />
            </View>
          ) : null}

          {listReady && !showTable
            ? groups.map((group) => (
                <PropertyGroupBlock
                  key={group.propertyId}
                  propertyId={group.propertyId}
                  applications={group.items}
                  applicants={applicantMap}
                  getAvatarFileId={getAvatarFileId}
                />
              ))
            : null}
        </PageScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
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
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
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
  applicantCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  cellText: {
    fontSize: 14,
    flexShrink: 1,
  },
  cellStrong: {
    fontWeight: '600',
  },
  skeletonGroup: {
    gap: spacing.md,
  },
  skeletonCard: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  skeletonBody: {
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
});
