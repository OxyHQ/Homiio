/**
 * Host reservations inbox.
 *
 * - Phones and narrow windows: status Chip filter row over `ReservationCard`s
 *   with approve / decline / view buttons in each card footer.
 * - Wide windows (`lg:`): a Bloom `DataTable` — status filter and property search in the
 *   toolbar, sortable dates / guests / nights / price, and approve / decline /
 *   view as row actions — so a host can triage many requests at once.
 *
 * Declining asks for confirmation through Bloom `confirm()` in both layouts.
 */
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueries } from '@tanstack/react-query';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { Chip } from '@oxy.so/bloom/chip';
import {
  DataTable,
  DataTableFilter,
  DataTableRowActions,
  DataTableSearch,
  type DataTableColumn,
  type DataTableRowActionItem,
} from '@oxy.so/bloom/data-table';
import { RiAlertLine } from '@oxy.so/bloom/icons/RiAlertLine';
import { RiCheckLine } from '@oxy.so/bloom/icons/RiCheckLine';
import { RiCloseLine } from '@oxy.so/bloom/icons/RiCloseLine';
import { RiEyeLine } from '@oxy.so/bloom/icons/RiEyeLine';
import { RiLoginBoxLine } from '@oxy.so/bloom/icons/RiLoginBoxLine';
import { RiMailLine } from '@oxy.so/bloom/icons/RiMailLine';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { H2, Text as BloomText } from '@oxy.so/bloom/typography';
import { useOxy } from '@oxy.so/services/ui/client';
import { useTranslation } from 'react-i18next';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import type { Reservation, Property } from '@homiio/shared-types';
import { ReservationStatus } from '@homiio/shared-types/reservation';
import { formatMoney } from '@homiio/shared-types/format/money';
import { ReservationCard } from '@/components/ReservationCard';
import { ReservationStatusBadge } from '@/components/ReservationStatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { ThumbnailImage } from '@/components/ui/ThumbnailImage';
import { useReservationsQuery } from '@/hooks/useReservationReads';
import { useReservationDecision } from '@/hooks/useReservationDecision';
import { propertyService } from '@/services/propertyService';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
import { useFormatting } from '@/utils/format';
import { spacing } from '@/constants/styles';

type StatusFilter = 'all' | ReservationStatus;

const FILTER_ENTRIES: { id: StatusFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'host.reservations.filterAll' },
  { id: ReservationStatus.PENDING, labelKey: 'host.reservations.filterPending' },
  { id: ReservationStatus.CONFIRMED, labelKey: 'host.reservations.filterConfirmed' },
  { id: ReservationStatus.DECLINED, labelKey: 'host.reservations.filterDeclined' },
  { id: ReservationStatus.CANCELLED, labelKey: 'host.reservations.filterCancelled' },
  { id: ReservationStatus.COMPLETED, labelKey: 'host.reservations.filterCompleted' },
];

const CardActions: React.FC<{ reservation: Reservation }> = ({ reservation }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { decide, busy, isPending } = useReservationDecision(reservation);

  if (reservation.status !== ReservationStatus.PENDING) return null;

  return (
    <>
      <Button
        size="sm"
        leadingIcon={RiCheckLine}
        loading={busy === ReservationStatus.CONFIRMED}
        disabled={isPending}
        onPress={() => void decide(ReservationStatus.CONFIRMED)}
        tone="accent"
        appearance="solid"
      >
        {t('host.reservations.approve')}
      </Button>
      <Button
        size="sm"
        leadingIcon={RiCloseLine}
        loading={busy === ReservationStatus.DECLINED}
        disabled={isPending}
        onPress={() => void decide(ReservationStatus.DECLINED)}
        tone="neutral"
        appearance="outline"
      >
        {t('host.reservations.decline')}
      </Button>
      <Button
        size="sm"
        onPress={() => router.push(`/reservations/${reservation.id}`)}
        tone="accent"
        appearance="subtle"
      >
        {t('host.reservations.view')}
      </Button>
    </>
  );
};

const RowActions: React.FC<{ reservation: Reservation; name: string }> = ({
  reservation,
  name,
}) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { decide } = useReservationDecision(reservation);

  const view: DataTableRowActionItem = {
    icon: RiEyeLine,
    label: t('host.reservations.view'),
    onPress: () => router.push(`/reservations/${reservation.id}`),
  };
  const actions: DataTableRowActionItem[] =
    reservation.status === ReservationStatus.PENDING
      ? [
          {
            icon: RiCheckLine,
            label: t('host.reservations.approve'),
            onPress: () => void decide(ReservationStatus.CONFIRMED),
          },
          {
            icon: RiCloseLine,
            label: t('host.reservations.decline'),
            onPress: () => void decide(ReservationStatus.DECLINED),
          },
          view,
        ]
      : [view];

  return <DataTableRowActions name={name} actions={actions} />;
};

const ReservationListSkeleton: React.FC = () => (
  <View style={styles.listWrap}>
    {Array.from({ length: 3 }).map((_, index) => (
      <Card key={index} radius="radius-16" className="gap-2 p-4" appearance="outline">
        <View style={styles.skeletonHeader}>
          <Skeleton.Text style={{ width: 140, lineHeight: 20 }} />
          <Skeleton.Pill size={20} />
        </View>
        <Skeleton.Text style={{ width: 200, lineHeight: 16 }} />
        <Skeleton.Text style={{ width: 160, lineHeight: 14 }} />
      </Card>
    ))}
  </View>
);

const formatDay = (iso: string): string => {
  const date = parseISO(iso);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'MMM d, yyyy');
};

const dayValue = (iso: string): Date | null => {
  const date = parseISO(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

interface ReservationsTableProps {
  items: Reservation[];
  statusFilter: StatusFilter;
  onStatusFilterChange: (next: StatusFilter) => void;
  filters: { id: StatusFilter; label: string }[];
  activeLabel: string;
}

const ReservationsTable: React.FC<ReservationsTableProps> = ({
  items,
  statusFilter,
  onStatusFilterChange,
  filters,
  activeLabel,
}) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { locale } = useFormatting();
  const [query, setQuery] = useState('');

  // Same query key / fetcher as `useProperty`, so the cache is shared with the
  // cards and the detail screen — without `useProperty`'s store side effect.
  const propertyIds = useMemo(
    () => Array.from(new Set(items.map((item) => item.propertyId))),
    [items],
  );
  const propertyQueries = useQueries({
    queries: propertyIds.map((id) => ({
      queryKey: ['property', id],
      queryFn: () => propertyService.getPropertyById(id),
      enabled: Boolean(id),
      staleTime: 1000 * 30,
      gcTime: 1000 * 60 * 10,
    })),
  });

  const propertiesById = useMemo(() => {
    const map = new Map<string, Property>();
    propertyIds.forEach((id, index) => {
      const property = propertyQueries[index]?.data;
      if (property) map.set(id, property);
    });
    return map;
  }, [propertyIds, propertyQueries]);

  const titleOf = useCallback(
    (reservation: Reservation) => {
      const property = propertiesById.get(reservation.propertyId);
      return property ? getPropertyTitle(property) : t('reservations.card.propertyFallback');
    },
    [propertiesById, t],
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => titleOf(item).toLowerCase().includes(needle));
  }, [items, query, titleOf]);

  const columns = useMemo<DataTableColumn<Reservation>[]>(
    () => [
      {
        id: 'property',
        header: t('host.calendar.property'),
        basis: 300,
        accessor: titleOf,
        cell: ({ row }) => {
          const property = propertiesById.get(row.propertyId);
          return (
            <Pressable
              onPress={() => router.push(`/reservations/${row.id}`)}
              accessibilityRole="link"
              accessibilityLabel={t('reservations.card.accessibility', { id: row.id })}
              style={styles.propertyCell}
            >
              <View style={styles.tableThumb}>
                <ThumbnailImage source={property ? getPropertyImageSource(property) : null} />
              </View>
              <View style={styles.propertyText}>
                <BloomText className="text-sm font-medium text-foreground" numberOfLines={1}>
                  {titleOf(row)}
                </BloomText>
                <View style={styles.badgeRow}>
                  <ReservationStatusBadge status={row.status} />
                </View>
              </View>
            </Pressable>
          );
        },
      },
      {
        id: 'checkIn',
        header: t('reservations.detail.checkIn'),
        basis: 130,
        accessor: (row) => dayValue(row.checkIn),
        sortDescFirst: false,
        cell: ({ row }) => (
          <BloomText className="text-sm text-foreground">{formatDay(row.checkIn)}</BloomText>
        ),
      },
      {
        id: 'checkOut',
        header: t('reservations.detail.checkOut'),
        basis: 130,
        accessor: (row) => dayValue(row.checkOut),
        sortDescFirst: false,
        cell: ({ row }) => (
          <BloomText className="text-sm text-foreground">{formatDay(row.checkOut)}</BloomText>
        ),
      },
      {
        id: 'guests',
        header: t('reservations.detail.guests'),
        basis: 90,
        accessor: (row) => row.guestCount,
      },
      {
        id: 'nights',
        header: t('reservations.detail.nights'),
        basis: 90,
        accessor: (row) => row.nights,
      },
      {
        id: 'price',
        header: t('reservations.detail.price'),
        basis: 120,
        accessor: (row) => row.total,
        cell: ({ row }) => (
          <BloomText className="text-sm font-medium text-foreground">
            {formatMoney(row.total, row.currency, locale)}
          </BloomText>
        ),
      },
      {
        id: 'actions',
        header: '',
        headerAccessibilityLabel: t('sindi.settings.actions'),
        width: 140,
        minWidth: 140,
        sortable: false,
        cell: ({ row }) => <RowActions reservation={row} name={titleOf(row)} />,
      },
    ],
    [t, titleOf, propertiesById, router, locale],
  );

  return (
    <DataTable
      accessibilityLabel={t('host.reservations.title')}
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      title={t('host.reservations.title')}
      summary={activeLabel}
      layout="inset"
      pageSize={10}
      minWidth={960}
      showSizeToggle
      defaultSort={{ columnId: 'checkIn', direction: 'ascending' }}
      emptyState={t('host.reservations.emptyTitle')}
      toolbar={
        <>
          <DataTableFilter
            label={t('common.filter')}
            value={statusFilter}
            onValueChange={(value) => onStatusFilterChange(value as StatusFilter)}
            options={filters.map((entry) => ({ value: entry.id, label: entry.label }))}
          />
          <DataTableSearch
            label={t('common.search')}
            placeholder={t('common.search')}
            value={query}
            onValueChange={setQuery}
          />
        </>
      }
    />
  );
};

export default function HostReservationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { oxyServices, activeSessionId, openAccountDialog } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const reservationsQuery = useReservationsQuery(
    {
      asHost: true,
      limit: 100,
      status: statusFilter === 'all' ? undefined : statusFilter,
    },
    { enabled: isAuthed },
  );

  const items = useMemo<Reservation[]>(
    () => reservationsQuery.data?.items ?? [],
    [reservationsQuery.data?.items],
  );

  const filters = FILTER_ENTRIES.map((entry) => ({
    id: entry.id,
    label: t(entry.labelKey),
  }));

  const header = (
    <PageHeader
      title={t('host.reservations.title')}
      titleAlign="center"
      leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
      onBack={router.canGoBack() ? router.back : undefined}
      backLabel={t('goBack')}
    />
  );

  if (!isAuthed) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView contentContainerStyle={styles.emptyWrap}>
          <EmptyState
            icon={RiMailLine}
            title={t('host.reservations.signInTitle')}
            description={t('host.reservations.signInDescription')}
            actionText={t('host.reservations.signIn')}
            actionIcon={RiLoginBoxLine}
            onAction={() => openAccountDialog()}
          />
        </ScreenScrollView>
      </Screen>
    );
  }

  if (!reservationsQuery.isOwnerReady) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView contentContainerStyle={styles.emptyWrap}>
          <ErrorState
            title={t('contracts.detail.signAccountUnavailable')}
            onRetry={() => openAccountDialog()}
            retryLabel={t('settings.sections.account')}
          />
        </ScreenScrollView>
      </Screen>
    );
  }

  const activeLabel =
    statusFilter === 'all'
      ? t('host.reservations.allReservations')
      : (filters.find((entry) => entry.id === statusFilter)?.label ?? t('host.reservations.title'));

  const isPaused = reservationsQuery.isPending && reservationsQuery.fetchStatus === 'paused';
  const isLoading = reservationsQuery.isPending && !isPaused;
  const isError = reservationsQuery.isError || isPaused;

  return (
    <Screen documentScroll header={header}>
      <ScreenScrollView contentContainerStyle={styles.content}>
        <View className="lg:hidden">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {filters.map((entry) => (
              <Chip
                key={entry.id}
                variant="subtle"
                selected={statusFilter === entry.id}
                onPress={() => setStatusFilter(entry.id)}
              >
                {entry.label}
              </Chip>
            ))}
          </ScrollView>
        </View>

        {isLoading ? <ReservationListSkeleton /> : null}

        {isError ? (
          <ErrorState
            icon={RiAlertLine}
            title={t('host.reservations.loadError')}
            description={reservationsQuery.error?.message ?? t('host.reservations.tryAgain')}
            onRetry={() => reservationsQuery.refetch()}
          />
        ) : null}

        {!isLoading && !isError ? (
          <View className="hidden lg:flex">
            <ReservationsTable
              items={items}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              filters={filters}
              activeLabel={activeLabel}
            />
          </View>
        ) : null}

        {!isLoading && !isError && items.length === 0 ? (
          <View style={styles.emptyWrap} className="lg:hidden">
            <EmptyState
              icon={RiMailLine}
              title={t('host.reservations.emptyTitle')}
              description={t('host.reservations.emptyDescription')}
            />
          </View>
        ) : null}

        {items.length > 0 ? (
          <View style={styles.listWrap} className="lg:hidden">
            <View style={styles.sectionHeader}>
              <SectionEyebrow>{t('host.reservations.title')}</SectionEyebrow>
              <H2 style={styles.sectionTitle}>{activeLabel}</H2>
            </View>
            {items.map((reservation) => (
              <ReservationCard
                key={reservation.id}
                reservation={reservation}
                variant="host"
                actions={<CardActions reservation={reservation} />}
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
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  emptyWrap: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  listWrap: {
    gap: spacing.md,
  },
  sectionHeader: {
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  sectionTitle: {
    letterSpacing: -0.5,
  },
  skeletonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  propertyCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexShrink: 1,
  },
  tableThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    overflow: 'hidden',
  },
  propertyText: {
    flexShrink: 1,
    gap: 4,
  },
  badgeRow: {
    flexDirection: 'row',
  },
});
