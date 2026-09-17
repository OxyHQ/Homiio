/**
 * Host reservations inbox.
 *
 * - Phones (and native): status Chip filter row over `ReservationCard`s with
 *   approve / decline / view buttons in each card footer.
 * - Wide web: a Bloom `DataTable` — status filter and property search in the
 *   toolbar, sortable dates / guests / nights / price, and approve / decline /
 *   view as row actions — so a host can triage many requests at once.
 *
 * Declining asks for confirmation through Bloom `confirm()` in both layouts.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueries } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { toast } from '@oxy.so/bloom/toast';
import { confirm } from '@oxy.so/bloom/surfaces';
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
import {
  RiAlertLine,
  RiCheckLine,
  RiCloseLine,
  RiEyeLine,
  RiLoginBoxLine,
  RiMailLine,
} from '@oxy.so/bloom/icons';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { H2, Text as BloomText } from '@oxy.so/bloom/typography';
import { useOxy, openAccountDialog } from '@oxy.so/services';
import { useTranslation } from 'react-i18next';
import {
  Reservation,
  ReservationStatus,
  formatMoney,
  type Property,
} from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { ReservationCard } from '@/components/ReservationCard';
import { ReservationStatusBadge } from '@/components/ReservationStatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { ThumbnailImage } from '@/components/ui/ThumbnailImage';
import { useIsDesktop } from '@/hooks/useOptimizedMediaQuery';
import {
  useReservationsQuery,
  useUpdateReservation,
} from '@/hooks/useReservationQueries';
import { propertyService } from '@/services/propertyService';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
import { useFormatting } from '@/utils/format';
import { spacing } from '@/constants/styles';
import { colors } from '@/styles/colors';

type StatusFilter = 'all' | ReservationStatus;

const FILTER_ENTRIES: { id: StatusFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'host.reservations.filterAll' },
  { id: ReservationStatus.PENDING, labelKey: 'host.reservations.filterPending' },
  { id: ReservationStatus.CONFIRMED, labelKey: 'host.reservations.filterConfirmed' },
  { id: ReservationStatus.DECLINED, labelKey: 'host.reservations.filterDeclined' },
  { id: ReservationStatus.CANCELLED, labelKey: 'host.reservations.filterCancelled' },
  { id: ReservationStatus.COMPLETED, labelKey: 'host.reservations.filterCompleted' },
];

type Decision = ReservationStatus.CONFIRMED | ReservationStatus.DECLINED;

/**
 * Approve / decline one pending reservation. Declining is confirmed first; the
 * outcome is reported by toast. Shared by the card footer and the table row.
 */
function useReservationDecision(reservation: Reservation) {
  const { t } = useTranslation();
  const mutation = useUpdateReservation(reservation.id);
  const [busy, setBusy] = useState<Decision | null>(null);

  const decide = useCallback(
    async (target: Decision) => {
      if (mutation.isPending) return;
      if (target === ReservationStatus.DECLINED) {
        const ok = await confirm({
          title: t('reservations.detail.confirmDeclineTitle'),
          description: t('reservations.detail.confirmDeclineBody'),
          confirmLabel: t('host.reservations.decline'),
          cancelLabel: t('common.cancel'),
          destructive: true,
        });
        if (!ok) return;
      }
      setBusy(target);
      try {
        await mutation.mutateAsync({ status: target });
        toast.success(
          target === ReservationStatus.CONFIRMED
            ? t('host.reservations.toastConfirmed')
            : t('host.reservations.toastDeclined'),
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t('host.reservations.toastUpdateFailed'),
        );
      } finally {
        setBusy(null);
      }
    },
    [mutation, t],
  );

  return { decide, busy, isPending: mutation.isPending };
}

const CardActions: React.FC<{ reservation: Reservation }> = ({ reservation }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { decide, busy, isPending } = useReservationDecision(reservation);

  if (reservation.status !== ReservationStatus.PENDING) return null;

  return (
    <>
      <Button
        variant="primary"
        size="small"
        leadingIcon={RiCheckLine}
        loading={busy === ReservationStatus.CONFIRMED}
        disabled={isPending}
        onPress={() => void decide(ReservationStatus.CONFIRMED)}
      >
        {t('host.reservations.approve')}
      </Button>
      <Button
        variant="secondary"
        size="small"
        leadingIcon={RiCloseLine}
        loading={busy === ReservationStatus.DECLINED}
        disabled={isPending}
        onPress={() => void decide(ReservationStatus.DECLINED)}
      >
        {t('host.reservations.decline')}
      </Button>
      <Button
        variant="ghost"
        size="small"
        onPress={() => router.push(`/reservations/${reservation.id}`)}
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
      <Card key={index} variant="outlined" radius="radius-16" className="gap-2 p-4">
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
        cell: ({ row }) => <BloomText className="text-sm">{formatDay(row.checkIn)}</BloomText>,
      },
      {
        id: 'checkOut',
        header: t('reservations.detail.checkOut'),
        basis: 130,
        accessor: (row) => dayValue(row.checkOut),
        sortDescFirst: false,
        cell: ({ row }) => <BloomText className="text-sm">{formatDay(row.checkOut)}</BloomText>,
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
          <BloomText className="text-sm font-medium">
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
            onChangeText={setQuery}
          />
        </>
      }
    />
  );
};

export default function HostReservationsScreen() {
  const { t } = useTranslation();
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const isDesktop = useIsDesktop();
  const showTable = Platform.OS === 'web' && isDesktop;

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

  if (!isAuthed) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: t('host.reservations.title'),
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.emptyWrap}>
            <EmptyState
              icon={RiMailLine}
              title={t('host.reservations.signInTitle')}
              description={t('host.reservations.signInDescription')}
              actionText={t('host.reservations.signIn')}
              actionIcon={RiLoginBoxLine}
              onAction={() => openAccountDialog()}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const activeLabel =
    statusFilter === 'all'
      ? t('host.reservations.allReservations')
      : filters.find((entry) => entry.id === statusFilter)?.label ?? t('host.reservations.title');

  const isLoading = reservationsQuery.isLoading;
  const isError = reservationsQuery.isError;

  return (
    <View style={styles.root}>
      <Header
        options={{
          showBackButton: true,
          title: t('host.reservations.title'),
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          {!showTable ? (
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
          ) : null}

          {isLoading ? <ReservationListSkeleton /> : null}

          {isError ? (
            <ErrorState
              icon={RiAlertLine}
              title={t('host.reservations.loadError')}
              description={
                reservationsQuery.error?.message ?? t('host.reservations.tryAgain')
              }
              onRetry={() => reservationsQuery.refetch()}
            />
          ) : null}

          {showTable && !isLoading && !isError ? (
            <ReservationsTable
              items={items}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              filters={filters}
              activeLabel={activeLabel}
            />
          ) : null}

          {!showTable && !isLoading && !isError && items.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon={RiMailLine}
                title={t('host.reservations.emptyTitle')}
                description={t('host.reservations.emptyDescription')}
              />
            </View>
          ) : null}

          {!showTable && items.length > 0 ? (
            <View style={styles.listWrap}>
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
