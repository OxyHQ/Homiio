/**
 * Contracts inbox — leases the user signs (tenant) or holds (landlord).
 *
 * - Phones: Bloom Chip status filters over a ContractCard (`LeaseSummaryCard`)
 *   list. The viewer's own home is `/my-home`.
 * - Wide windows (`lg:`): a Bloom DataTable — sortable columns, a status filter
 *   and a search over property and party names in its toolbar, and a "View"
 *   row action — so a landlord scanning many leases gets a real table.
 * - "New contract" routes to `/contracts/new`, which only creates a lease from
 *   an `?application=` id (and otherwise guides to applications).
 * - The "no rental properties" empty state is for somebody with NEITHER a
 *   property NOR a lease: a tenant owns nothing and still has a contract.
 * - Party names are the Oxy accounts' display names, resolved in one batch;
 *   an account that does not resolve shows a dash, never an id.
 */
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
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
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiAlertLine } from '@oxy.so/bloom/icons/RiAlertLine';
import { RiEyeLine } from '@oxy.so/bloom/icons/RiEyeLine';
import { RiFileTextLine } from '@oxy.so/bloom/icons/RiFileTextLine';
import { RiHomeLine } from '@oxy.so/bloom/icons/RiHomeLine';
import { H2, Text as BloomText } from '@oxy.so/bloom/typography';
import { formatMoney } from '@homiio/shared-types';
import { ContractCard } from '@/components/ContractCard';
import { ContractStatusBadge } from '@/components/ContractStatusBadge';
import { useLeaseFormatContext } from '@/components/tenancy/useLeaseFormatContext';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { useUserLeases, useHasRentalProperties } from '@/hooks/useLeaseQueries';
import type { Lease } from '@/services/leaseService';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { useFormatting } from '@/utils/format';
import { formatLocalized } from '@/utils/dateLocale';
import { spacing } from '@/constants/styles';

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
  lease: Lease;
  propertyName: string;
  startDate: string;
  endDate: string;
  status: Lease['status'];
  landlordName: string;
  tenantName: string;
  monthlyRent: number;
  currency?: string;
}

export default function ContractsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { locale } = useFormatting();
  const [filter, setFilter] = useState<FilterOption>('all');
  const [query, setQuery] = useState('');

  const {
    data: leasesData,
    isLoading: leasesLoading,
    error: leasesError,
    refetch: refetchLeases,
  } = useUserLeases();
  const { hasRentalProperties, isLoading: hasPropertiesLoading } = useHasRentalProperties();

  const leases = useMemo<Lease[]>(() => leasesData?.leases ?? [], [leasesData]);
  const format = useLeaseFormatContext(leases);

  const contracts = useMemo<ContractRow[]>(
    () =>
      leases.map((lease) => ({
        id: lease.id,
        lease,
        propertyName: leasePropertyTitle(lease.property),
        startDate: lease.leaseTerms?.startDate ?? '',
        endDate: lease.leaseTerms?.endDate ?? '',
        status: lease.status,
        landlordName: format.resolveParty(lease.landlordOxyUserId)?.name ?? '—',
        tenantName: format.resolveParty(lease.tenantOxyUserId)?.name ?? '—',
        monthlyRent: lease.rentDetails?.monthlyRent ?? 0,
        currency: lease.rentDetails?.currency,
      })),
    [leases, format],
  );

  const filteredContracts = useMemo(() => {
    const byStatus =
      filter === 'all' ? contracts : contracts.filter((contract) => contract.status === filter);
    const needle = query.trim().toLowerCase();
    if (!needle) return byStatus;
    return byStatus.filter((contract) =>
      [contract.propertyName, contract.landlordName, contract.tenantName].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [contracts, filter, query]);

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
        cell: ({ row }) => (
          <BloomText style={styles.cellText}>{formatDate(row.startDate)}</BloomText>
        ),
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

  const header = (
    <PageHeader
      title={t('contracts.list.title')}
      titleAlign="center"
      leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
    />
  );

  if (
    !hasPropertiesLoading &&
    !hasRentalProperties &&
    !leasesLoading &&
    !leasesError &&
    contracts.length === 0
  ) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView>
          <EmptyState
            icon={RiFileTextLine}
            title={t('contracts.list.noRentalPropertiesTitle')}
            description={t('contracts.list.noRentalPropertiesDescription')}
            actionText={t('contracts.list.browseProperties')}
            actionIcon={RiHomeLine}
            onAction={() => router.push('/')}
          />
        </ScreenScrollView>
      </Screen>
    );
  }

  const isLoading = leasesLoading || hasPropertiesLoading;
  const hasNoContracts = !leasesLoading && !leasesError && contracts.length === 0;

  return (
    <Screen
      documentScroll
      header={header}
      bottomBar={
        <View className="lg:hidden p-4 bg-card border-t border-border">
          <Button
            size="lg"
            onPress={handleAddNewContract}
            leadingIcon={RiAddLine}
            style={styles.footerButton}
            tone="accent"
            appearance="solid"
          >
            {t('contracts.list.newContract')}
          </Button>
        </View>
      }
    >
      <ScreenScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <View style={styles.titleBlock}>
            <SectionEyebrow>{t('contracts.list.eyebrow')}</SectionEyebrow>
            <H2 style={styles.title}>{t('contracts.list.title')}</H2>
            <BloomText className="text-sm text-muted-foreground">
              {t('contracts.list.subtitle')}
            </BloomText>
          </View>
          <View className="hidden lg:flex">
            <Button
              size="md"
              onPress={handleAddNewContract}
              leadingIcon={RiAddLine}
              tone="accent"
              appearance="solid"
            >
              {t('contracts.list.newContract')}
            </Button>
          </View>
        </View>

        <View className="lg:hidden">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {FILTERS.map((entry) => (
              <Chip
                key={entry.id}
                size="lg"
                onPress={() => setFilter(entry.id)}
                selected={filter === entry.id}
              >
                {t(entry.i18nKey)}
              </Chip>
            ))}
          </ScrollView>
        </View>

        {isLoading ? <ListSkeleton rows={3} rowHeight={280} /> : null}

        {leasesError ? (
          <ErrorState
            icon={RiAlertLine}
            title={t('contracts.list.loadError')}
            description={leasesError?.message || t('contracts.list.tryAgain')}
            onRetry={() => refetchLeases()}
          />
        ) : null}

        {!isLoading && !leasesError && !hasNoContracts ? (
          <View className="hidden lg:flex">
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
                    onValueChange={setQuery}
                  />
                </>
              }
              defaultSort={{ columnId: 'start', direction: 'descending' }}
              pageSize={20}
              minWidth={1000}
              emptyState={
                <BloomText className="text-sm text-muted-foreground">
                  {query.trim() ? t('contracts.list.emptyTitle') : emptyDescription}
                </BloomText>
              }
            />
          </View>
        ) : null}

        {/* No contracts at all: empty state everywhere. A filter that matches
            nothing: only the card list needs it — the table has its own. */}
        {!isLoading && !leasesError && filteredContracts.length === 0 ? (
          <View style={styles.emptyWrap} className={hasNoContracts ? undefined : 'lg:hidden'}>
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

        {filteredContracts.length > 0 ? (
          <View style={styles.listWrap} className="lg:hidden">
            {filteredContracts.map((contract) => (
              <ContractCard
                key={contract.id}
                lease={contract.lease}
                title={contract.propertyName}
                format={format}
                onPress={() => handleContractPress(contract.id)}
              />
            ))}
          </View>
        ) : null}
      </ScreenScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  footerButton: {
    alignSelf: 'stretch',
  },
});
