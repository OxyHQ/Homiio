/**
 * Contracts inbox — leases the user signs (tenant) or holds (landlord).
 *
 * - Phones: Bloom Chip status filters over a ContractCard list.
 * - Wide web (1024px+): a Bloom DataTable — sortable columns, a status filter
 *   and a search over property and party names in its toolbar, and a "View"
 *   row action — so a landlord scanning many leases gets a real table.
 * - "New contract" routes to `/contracts/new`, which only creates a lease from
 *   an `?application=` id (and otherwise guides to applications).
 */
import React, { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import {
  DataTable,
  DataTableFilter,
  DataTableRowActions,
  DataTableSearch,
  type DataTableColumn,
} from '@oxy.so/bloom/data-table';
import {
  RiAddLine,
  RiAlertLine,
  RiEyeLine,
  RiFileTextLine,
  RiHomeLine,
} from '@oxy.so/bloom/icons';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { H2, Text as BloomText } from '@oxy.so/bloom/typography';
import { formatMoney } from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { ContractCard, ContractStatus } from '@/components/ContractCard';
import { ContractStatusBadge } from '@/components/ContractStatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { useUserLeases, useHasRentalProperties } from '@/hooks/useLeaseQueries';
import { useIsDesktop } from '@/hooks/useOptimizedMediaQuery';
import type { Lease } from '@/services/leaseService';
import type { Profile } from '@homiio/shared-types';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { useFormatting } from '@/utils/format';
import { formatLocalized } from '@/utils/dateLocale';
import { radius, spacing } from '@/constants/styles';
import { colors } from '@/styles/colors';

/**
 * Derive a human-readable name from a Homiio Profile. Profiles do not carry a
 * raw person name; the displayable identity depends on the profile type
 * (matches the derivation used in LandlordSection / HostStatsCard).
 */
const profileDisplayName = (profile?: Profile): string => {
  if (!profile) return 'Unknown';
  return profile.personalProfile?.personalInfo?.bio?.trim() || profile.oxyUserId || 'Unknown';
};

/**
 * Build a display title for the property a lease is attached to. Properties
 * have no `title` field, so derive one from the address/type.
 */
const leasePropertyTitle = (property?: Lease['property']): string => {
  if (!property) return 'Property';
  return generatePropertyTitle({
    type: property.type,
    address: property.address,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
  });
};

const toDate = (raw: string): Date | null => {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (raw: string): string => {
  const date = toDate(raw);
  return date ? formatLocalized(date, 'MMM d, yyyy') : raw || '—';
};

type FilterOption = 'all' | 'active' | 'pending_signatures' | 'expired' | 'draft';

const FILTERS: { id: FilterOption; i18nKey: string }[] = [
  { id: 'all', i18nKey: 'contracts.list.filterAll' },
  { id: 'active', i18nKey: 'contracts.list.filterActive' },
  { id: 'pending_signatures', i18nKey: 'contracts.list.filterPending' },
  { id: 'expired', i18nKey: 'contracts.list.filterExpired' },
  { id: 'draft', i18nKey: 'contracts.list.filterDrafts' },
];

interface ContractRow {
  id: string;
  title: string;
  propertyId: string;
  propertyName: string;
  startDate: string;
  endDate: string;
  status: ContractStatus;
  landlordName: string;
  tenantName: string;
  monthlyRent: number;
  currency?: string;
}

const ContractsSkeleton: React.FC = () => (
  <View style={styles.listWrap}>
    {Array.from({ length: 3 }).map((_, idx) => (
      <View key={idx} style={styles.skeletonCard}>
        <View style={styles.skeletonHeader}>
          <Skeleton.Text style={{ width: 180, lineHeight: 20 }} />
          <Skeleton.Pill size={22} />
        </View>
        <Skeleton.Text style={{ width: 220, lineHeight: 14 }} />
        <Skeleton.Box width="100%" height={56} borderRadius={radius.md} />
        <Skeleton.Text style={{ width: 140, lineHeight: 14 }} />
      </View>
    ))}
  </View>
);

export default function ContractsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { locale } = useFormatting();
  const isDesktop = useIsDesktop();
  const showTable = Platform.OS === 'web' && isDesktop;
  const [filter, setFilter] = useState<FilterOption>('all');
  const [query, setQuery] = useState('');

  const {
    data: leasesData,
    isLoading: leasesLoading,
    error: leasesError,
    refetch: refetchLeases,
  } = useUserLeases();
  const { hasRentalProperties, isLoading: hasPropertiesLoading } =
    useHasRentalProperties();

  const contracts = useMemo<ContractRow[]>(() => {
    if (!leasesData?.leases) return [];
    return leasesData.leases.map((lease: Lease) => {
      const propertyTitle = leasePropertyTitle(lease.property);
      return {
        id: lease.id,
        title: propertyTitle,
        propertyId: lease.propertyId,
        propertyName: propertyTitle,
        startDate: lease.leaseTerms?.startDate ?? '',
        endDate: lease.leaseTerms?.endDate ?? '',
        status: lease.status as ContractStatus,
        landlordName: profileDisplayName(lease.landlord),
        tenantName: profileDisplayName(lease.tenant),
        monthlyRent: lease.rentDetails?.monthlyRent ?? 0,
        currency: lease.rentDetails?.currency,
      };
    });
  }, [leasesData]);

  const filteredContracts = useMemo(() => {
    const byStatus =
      filter === 'all' ? contracts : contracts.filter((contract) => contract.status === filter);
    const needle = showTable ? query.trim().toLowerCase() : '';
    if (!needle) return byStatus;
    return byStatus.filter((contract) =>
      [contract.propertyName, contract.landlordName, contract.tenantName].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [contracts, filter, query, showTable]);

  const handleContractPress = (contractId: string) => {
    router.push(`/contracts/${contractId}`);
  };

  const handleAddNewContract = () => {
    router.push('/contracts/new');
  };

  const filterLabel = (entry: FilterOption) =>
    t(`statusBadge.${entry === 'pending_signatures' ? 'pendingSignatures' : entry}`);

  const emptyDescription =
    filter === 'all'
      ? t('contracts.list.emptyAllDescription')
      : t('contracts.list.emptyFilteredDescription', { filter: filterLabel(filter) });

  const columns = useMemo<DataTableColumn<ContractRow>[]>(
    () => [
      {
        id: 'property',
        header: t('contracts.detail.propertyFallback'),
        basis: 260,
        accessor: (row) => row.propertyName,
        cell: ({ row }) => (
          <BloomText style={styles.cellPrimary} numberOfLines={1}>
            {row.propertyName}
          </BloomText>
        ),
      },
      {
        id: 'status',
        header: t('contracts.list.columnStatus'),
        basis: 150,
        accessor: (row) => row.status,
        cell: ({ row }) => <ContractStatusBadge status={row.status} />,
      },
      {
        id: 'landlord',
        header: t('contracts.card.landlord'),
        basis: 160,
        accessor: (row) => row.landlordName,
      },
      {
        id: 'tenant',
        header: t('contracts.card.tenant'),
        basis: 160,
        accessor: (row) => row.tenantName,
      },
      {
        id: 'start',
        header: t('contracts.card.start'),
        basis: 120,
        accessor: (row) => toDate(row.startDate),
        cell: ({ row }) => <BloomText style={styles.cellText}>{formatDate(row.startDate)}</BloomText>,
      },
      {
        id: 'end',
        header: t('contracts.card.end'),
        basis: 120,
        accessor: (row) => toDate(row.endDate),
        cell: ({ row }) => <BloomText style={styles.cellText}>{formatDate(row.endDate)}</BloomText>,
      },
      {
        id: 'rent',
        header: t('contracts.detail.monthlyRent'),
        basis: 130,
        align: 'end',
        accessor: (row) => row.monthlyRent,
        cell: ({ row }) => (
          <BloomText style={styles.cellPrimary}>
            {formatMoney(row.monthlyRent, row.currency ?? 'EUR', locale)}
          </BloomText>
        ),
      },
      {
        id: 'actions',
        header: '',
        width: 64,
        sortable: false,
        cell: ({ row }) => (
          <DataTableRowActions
            name={row.propertyName}
            actions={[
              {
                icon: RiEyeLine,
                label: t('contracts.actions.view'),
                onPress: () => router.push(`/contracts/${row.id}`),
              },
            ]}
          />
        ),
      },
    ],
    [t, locale, router],
  );

  if (!hasPropertiesLoading && !hasRentalProperties) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            title: t('contracts.list.title'),
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <EmptyState
            icon={RiFileTextLine}
            title={t('contracts.list.noRentalPropertiesTitle')}
            description={t('contracts.list.noRentalPropertiesDescription')}
            actionText={t('contracts.list.browseProperties')}
            actionIcon={RiHomeLine}
            onAction={() => router.push('/')}
          />
        </SafeAreaView>
      </View>
    );
  }

  const newContractButton = (
    <Button
      variant="primary"
      size={showTable ? 'medium' : 'large'}
      onPress={handleAddNewContract}
      leadingIcon={RiAddLine}
      style={showTable ? undefined : styles.footerButton}
    >
      {t('contracts.list.newContract')}
    </Button>
  );

  const isLoading = leasesLoading || hasPropertiesLoading;
  const hasNoContracts = !leasesLoading && !leasesError && contracts.length === 0;

  return (
    <View style={styles.root}>
      <Header
        options={{
          title: t('contracts.list.title'),
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.titleRow}>
            <View style={styles.titleBlock}>
              <SectionEyebrow>{t('contracts.list.eyebrow')}</SectionEyebrow>
              <H2 style={styles.title}>{t('contracts.list.title')}</H2>
              <BloomText style={styles.subtitle}>{t('contracts.list.subtitle')}</BloomText>
            </View>
            {showTable ? newContractButton : null}
          </View>

          {!showTable ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {FILTERS.map((entry) => (
                <Chip
                  key={entry.id}
                  size="large"
                  onPress={() => setFilter(entry.id)}
                  selected={filter === entry.id}
                >
                  {t(entry.i18nKey)}
                </Chip>
              ))}
            </ScrollView>
          ) : null}

          {isLoading ? <ContractsSkeleton /> : null}

          {leasesError ? (
            <ErrorState
              icon={RiAlertLine}
              title={t('contracts.list.loadError')}
              description={leasesError?.message || t('contracts.list.tryAgain')}
              onRetry={() => refetchLeases()}
            />
          ) : null}

          {showTable && !isLoading && !leasesError && !hasNoContracts ? (
            <DataTable
              accessibilityLabel={t('contracts.list.title')}
              rows={filteredContracts}
              columns={columns}
              getRowId={(row) => row.id}
              toolbar={
                <>
                  <DataTableFilter
                    label={t('contracts.list.filterLabel')}
                    value={filter}
                    onValueChange={(value) => setFilter(value as FilterOption)}
                    options={FILTERS.map((entry) => ({ value: entry.id, label: t(entry.i18nKey) }))}
                  />
                  <DataTableSearch
                    label={t('contracts.list.searchLabel')}
                    placeholder={t('common.search')}
                    value={query}
                    onChangeText={setQuery}
                  />
                </>
              }
              defaultSort={{ columnId: 'start', direction: 'descending' }}
              pageSize={20}
              minWidth={1000}
              emptyState={
                <BloomText style={styles.subtitle}>
                  {query.trim() ? t('contracts.list.emptyTitle') : emptyDescription}
                </BloomText>
              }
            />
          ) : null}

          {!isLoading && !leasesError && (showTable ? hasNoContracts : filteredContracts.length === 0) ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon={RiFileTextLine}
                title={t('contracts.list.emptyTitle')}
                description={emptyDescription}
                actionText={t('contracts.list.createNew')}
                actionIcon={RiAddLine}
                onAction={handleAddNewContract}
              />
            </View>
          ) : null}

          {!showTable && filteredContracts.length > 0 ? (
            <View style={styles.listWrap}>
              {filteredContracts.map((contract) => (
                <ContractCard
                  key={contract.id}
                  {...contract}
                  onPress={() => handleContractPress(contract.id)}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>

        {!showTable ? <View style={styles.footer}>{newContractButton}</View> : null}
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
    paddingBottom: spacing['4xl'],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  titleBlock: {
    flex: 1,
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
  listWrap: {
    gap: spacing.md,
  },
  cellPrimary: {
    fontSize: 14,
    fontWeight: '600',
  },
  cellText: {
    fontSize: 14,
  },
  skeletonCard: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skeletonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footer: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerButton: {
    alignSelf: 'stretch',
  },
});
