/**
 * My home — the tenant's side of an ACTIVE lease: the lease at a glance, the
 * rent schedule, the documents and the lease's history. Bloom's housing
 * template (`templates/housing/MyHomePage.tsx`) inside Homiio's own frame.
 *
 * ## Only what the API has
 *
 * Everything here is `GET /api/leases?status=active` — the same leases the
 * contracts inbox reads — filtered to the ones the viewer RENTS (tenant or
 * co-tenant; a landlord's active lease is somebody else's home). The template
 * also draws repair requests, "Pay rent" and "Message landlord"; Homiio has no
 * maintenance, rent-payment or tenant–landlord messaging endpoint, so those are
 * absent rather than buttons that do nothing. Signing, terminating and adding
 * documents stay on `/contracts/[id]`, which "View contract" opens.
 *
 * Several active tenancies (a room and a parking space, a move between two
 * flats) are chosen between with chips; one is the common case and draws none.
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
import { leaseSummaryProps } from '@/components/tenancy/leaseTenancy';
import {
  LeaseDocumentsSection,
  LeaseHistorySection,
  LeasePaymentsSection,
} from '@/components/tenancy/LeaseSections';
import { useLeaseFormatContext } from '@/components/tenancy/useLeaseFormatContext';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { useUserLeases } from '@/hooks/useLeaseQueries';
import { useIsDesktop } from '@/hooks/useOptimizedMediaQuery';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { getPropertyImageSource } from '@/utils/propertyUtils';
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
    return frame(
      <View style={styles.centerWrap}>
        <EmptyState
          icon={RiHomeHeartLine}
          title={t('myHome.emptyTitle')}
          description={t('myHome.emptyDescription')}
          actionText={t('sidebar.navigation.explore')}
          actionIcon={RiCompass3Line}
          onAction={() => router.push('/explore')}
        />
      </View>,
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
      <LeasePaymentsSection lease={lease} format={format} />
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
