/**
 * My home — the tenant's side of an ACTIVE lease: the lease at a glance, the
 * rent schedule, the documents and the lease's history. Bloom's housing
 * template (`templates/housing/MyHomePage.tsx`) inside Homiio's own frame.
 *
 * ## What the API has, and what it still does not
 *
 * The leases come from `GET /api/leases?status=active` — the same ones the
 * contracts inbox reads — filtered to the tenancies the viewer RENTS (tenant or
 * co-tenant; a landlord's active lease is somebody else's home). Signing,
 * terminating and adding documents stay on `/contracts/[id]`, which "View
 * contract" opens.
 *
 * **Repairs are now real.** This header used to say Homiio had no maintenance
 * endpoint, so the template's repair section was "absent rather than buttons
 * that do nothing" — honest, and rejected as an ending by #518 §7.1 and
 * #519 §7.1. `/api/maintenance` exists, and `MaintenanceSection` is the
 * surface: report, comment, and every transition the server says the viewer may
 * take. Photos are still absent, and for a reason that has not gone away —
 * Homiio's only upload path is the PUBLIC image endpoint, and a tenancy's
 * evidence may not go through it.
 *
 * **"Pay rent" and "Message landlord" are still absent.** Rent payments are a
 * schedule of obligations rather than a ledger, and the Inbox tab is a
 * notification list rather than a conversation. Both are named in
 * `docs/housing-parity.md`; neither is drawn as a button that cannot work.
 *
 * Several active tenancies (a room and a parking space, a move between two
 * flats) are chosen between with chips; one is the common case and draws none.
 *
 * **Bookings are now on this screen** (#518 §7.5). A tenancy is not only a
 * lease: a confirmed stay, an accepted swap and an approved viewing are dated
 * commitments the person must not miss, and the screen named for their home
 * mentioned none of them. `UpcomingBookingsSection` draws them, and its own
 * header argues why only COMMITTED rows belong here.
 *
 * It sits OUTSIDE the lease gate on purpose. A person can have a confirmed stay
 * next week and no active tenancy at all — a guest, somebody between flats — and
 * sending them to the "no active tenancy" empty state while their own booking
 * sat one query away is the defect, not a lesser version of it.
 */
import React, { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import {
  RiArrowRightSLine,
  RiCompass3Line,
  RiHomeHeartLine,
  RiLoginBoxLine,
} from '@oxy.so/bloom/icons';
import { LeaseSummaryCard } from '@oxy.so/bloom/tenancy';
import { useTheme } from '@oxy.so/bloom/theme';
import { openAccountDialog, useOxy } from '@oxy.so/services';
import { LeaseStatus, type Lease } from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { UpcomingBookingsSection } from '@/components/bookings/UpcomingBookingsSection';
import { leaseSummaryProps } from '@/components/tenancy/leaseTenancy';
import {
  LeaseDocumentsSection,
  LeaseHistorySection,
  LeasePaymentsSection,
} from '@/components/tenancy/LeaseSections';
import { LeaseLedgerSection } from '@/components/tenancy/LeaseLedgerSection';
import { MaintenanceSection } from '@/components/tenancy/MaintenanceSection';
import { useLeaseFormatContext } from '@/components/tenancy/useLeaseFormatContext';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { useUserLeases } from '@/hooks/useLeaseQueries';
import { useIsDesktop } from '@/hooks/useOptimizedMediaQuery';
import { useUpcomingBookings } from '@/hooks/useUpcomingBookings';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { getPropertyImageSource } from '@/utils/propertyUtils';
import { COMMITTED_ONLY } from '@/utils/upcomingBookings';
import { radius, spacing } from '@/constants/styles';

const ACTIVE_FILTER = { status: LeaseStatus.ACTIVE };

const homeTitle = (lease: Lease, fallback: string): string =>
  lease.property
    ? generatePropertyTitle({
        type: lease.property.type,
        address: lease.property.address,
        bedrooms: lease.property.bedrooms,
        bathrooms: lease.property.bathrooms,
      })
    : fallback;

export default function MyHomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const isDesktop = useIsDesktop();
  const { user, oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);

  const leasesQuery = useUserLeases(ACTIVE_FILTER);
  const homes = useMemo(() => {
    const viewer = user?.id;
    if (!viewer) return [];
    return (leasesQuery.data?.leases ?? []).filter(
      (lease) =>
        lease.status === LeaseStatus.ACTIVE &&
        (lease.tenantOxyUserId === viewer ||
          (lease.coTenants ?? []).some((coTenant) => coTenant.oxyUserId === viewer)),
    );
  }, [leasesQuery.data?.leases, user?.id]);
  const format = useLeaseFormatContext(homes);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lease = homes.find((home) => home.id === selectedId) ?? homes[0];

  // `COMMITTED_ONLY`: an open request is not a date somebody has to keep, so it
  // stays on Saved (`UpcomingBookingsSection`'s header argues it). Not scoped to
  // the selected tenancy either — a booking is the VIEWER's, not a lease's, and
  // filtering by `lease.propertyId` would hide the stay in another city that is
  // the whole reason to look.
  const bookings = useUpcomingBookings({
    enabled: isAuthed,
    statuses: COMMITTED_ONLY,
    includeViewings: true,
  });

  const header = <Header options={{ title: t('sidebar.navigation.myHome') }} />;
  const frame = (body: React.ReactNode) => (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {header}
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        {body}
      </SafeAreaView>
    </View>
  );

  if (!isAuthed) {
    return frame(
      <View style={styles.centerWrap}>
        <EmptyState
          icon={RiHomeHeartLine}
          title={t('myHome.signInTitle')}
          description={t('myHome.signInDescription')}
          actionText={t('applications.list.signIn')}
          actionIcon={RiLoginBoxLine}
          onAction={() => openAccountDialog()}
        />
      </View>,
    );
  }

  if (leasesQuery.isPending) {
    return frame(
      <View style={styles.content}>
        <ListSkeleton rows={3} rowHeight={180} />
      </View>,
    );
  }

  if (leasesQuery.isError) {
    return frame(
      <View style={styles.centerWrap}>
        <ErrorState
          title={t('contracts.list.loadError')}
          description={leasesQuery.error?.message}
          onRetry={() => void leasesQuery.refetch()}
        />
      </View>,
    );
  }

  if (!lease) {
    const noTenancy = (
      <EmptyState
        icon={RiHomeHeartLine}
        title={t('myHome.emptyTitle')}
        description={t('myHome.emptyDescription')}
        actionText={t('sidebar.navigation.explore')}
        actionIcon={RiCompass3Line}
        onAction={() => router.push('/explore')}
      />
    );
    // "No active tenancy" is TRUE here and stays on screen — but it is not the
    // whole truth for a guest with a confirmed stay, so the bookings join it
    // once they have something to say. While they are still loading the page
    // keeps the centred empty state rather than flickering between two
    // layouts: the lease answer is already final and is not what is pending.
    const bookingsHaveSomethingToSay =
      !bookings.isPending && (bookings.isError || bookings.items.length > 0);
    if (!bookingsHaveSomethingToSay) {
      return frame(<View style={styles.centerWrap}>{noTenancy}</View>);
    }
    return frame(
      <ScrollView contentContainerStyle={styles.content}>
        <UpcomingBookingsSection bookings={bookings} />
        {noTenancy}
      </ScrollView>,
    );
  }

  const title = homeTitle(lease, t('contracts.detail.propertyFallback'));
  const imageSource = lease.property ? getPropertyImageSource(lease.property) : null;
  const cityLine = lease.property?.address
    ? [lease.property.address.cityName, lease.property.address.countryName]
        .filter(Boolean)
        .join(', ')
    : '';

  const thumbnail = imageSource ? (
    <View style={[styles.thumbWrap, { backgroundColor: colors.backgroundSecondary }]}>
      <Image source={imageSource} style={styles.thumb} resizeMode="cover" />
    </View>
  ) : null;
  const history = <LeaseHistorySection lease={lease} format={format} compact={isDesktop} />;

  const main = (
    <View style={styles.column}>
      <LeaseSummaryCard
        {...leaseSummaryProps(lease, title, format)}
        subtitle={cityLine || undefined}
        headingLevel={2}
        actions={
          <Button
            variant="secondary"
            size="small"
            trailingIcon={RiArrowRightSLine}
            onPress={() => router.push(`/contracts/${lease.id}`)}
          >
            {t('myHome.viewContract')}
          </Button>
        }
      />
      {isDesktop ? null : history}
      {/* Above the money, and the ledger's own comment below is not being
          overruled: it argues the BALANCE outranks the SCHEDULE, which is
          still true of the two of them. This outranks both for a different
          reason — a balance can be settled tomorrow, and Tuesday's viewing
          cannot be attended on Wednesday. */}
      <UpcomingBookingsSection bookings={bookings} />
      {/* The LEDGER: what is owed, what settled, and what the tenant has merely
          claimed. Above the schedule, because "how much do I still owe?" is the
          question somebody opens this screen with — and because the schedule
          below it lists obligations, which is a different fact. */}
      <LeaseLedgerSection
        lease={lease}
        // This screen only ever shows tenancies the viewer RENTS (see the
        // filter above), so the viewer is never the landlord here. Passed
        // explicitly rather than assumed inside the component, because the
        // contract screen will mount the same section for the other side.
        viewerIsLandlord={false}
      />
      <LeasePaymentsSection lease={lease} format={format} />
      {/* Above documents: a repair is something happening now, and a lease's
          paperwork is reference. The order follows what somebody opening this
          screen is most likely to have come for. */}
      <MaintenanceSection
        leaseId={lease.id}
        onReport={() => router.push(`/maintenance/new?lease=${lease.id}`)}
        onOpenRequest={(requestId) => router.push(`/maintenance/${requestId}`)}
      />
      <LeaseDocumentsSection lease={lease} format={format} />
    </View>
  );

  return frame(
    <ScrollView contentContainerStyle={styles.content}>
      {homes.length > 1 ? (
        <View style={styles.chipRow}>
          {homes.map((home) => (
            <Chip
              key={home.id}
              selected={home.id === lease.id}
              onPress={() => setSelectedId(home.id)}
            >
              {homeTitle(home, t('contracts.detail.propertyFallback'))}
            </Chip>
          ))}
        </View>
      ) : null}

      {isDesktop ? (
        <View style={styles.wideRow}>
          {main}
          <View style={styles.aside}>
            {thumbnail}
            {history}
          </View>
        </View>
      ) : (
        <>
          {thumbnail}
          {main}
        </>
      )}
    </ScrollView>,
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
    paddingBottom: spacing['4xl'],
  },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['2xl'],
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  wideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing['2xl'],
  },
  column: {
    flex: 1,
    minWidth: 0,
    gap: spacing.lg,
  },
  aside: {
    width: 340,
    gap: spacing.lg,
  },
  thumbWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.photo,
    overflow: 'hidden',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
});
