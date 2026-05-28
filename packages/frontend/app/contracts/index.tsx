/**
 * Contracts inbox — leases the user signs (tenant) or holds (landlord).
 *
 * Stream Q polish:
 *   - Bloom Chip filter row, Bloom Button "New contract" CTA in the header.
 *   - withShadow('sm') ContractCard list with radius.lg.
 *   - Bloom Skeleton + shared EmptyState / ErrorState.
 *   - Bloom Typography (H2, Text) and SectionEyebrow for hierarchy.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import { Chip } from '@oxyhq/bloom/chip';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { H2, Text as BloomText } from '@oxyhq/bloom/typography';
import { Header } from '@/components/Header';
import { ContractCard, ContractStatus } from '@/components/ContractCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { useUserLeases, useHasRentalProperties } from '@/hooks/useLeaseQueries';
import type { Lease } from '@/services/leaseService';
import { radius, spacing, withShadow } from '@/constants/styles';
import { colors } from '@/styles/colors';

type FilterOption = 'all' | 'active' | 'pending_signature' | 'expired' | 'draft';

const FILTERS: { id: FilterOption; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'pending_signature', label: 'Pending' },
  { id: 'expired', label: 'Expired' },
  { id: 'draft', label: 'Drafts' },
];

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
  const [filter, setFilter] = useState<FilterOption>('all');

  const {
    data: leasesData,
    isLoading: leasesLoading,
    error: leasesError,
    refetch: refetchLeases,
  } = useUserLeases();
  const { hasRentalProperties, isLoading: hasPropertiesLoading } =
    useHasRentalProperties();

  const contracts = useMemo(() => {
    if (!leasesData?.leases) return [];
    return leasesData.leases.map((lease: Lease) => ({
      id: lease.id,
      title:
        lease.property?.title ||
        `Lease for ${lease.property?.address?.street || 'Property'}`,
      propertyId: lease.propertyId,
      propertyName:
        lease.property?.title ||
        `${lease.property?.address?.street}, ${lease.property?.address?.city}`,
      startDate: lease.startDate,
      endDate: lease.endDate,
      status: lease.status as ContractStatus,
      landlordName: lease.landlord
        ? `${lease.landlord.firstName} ${lease.landlord.lastName}`
        : 'Unknown',
      tenantName: lease.tenant
        ? `${lease.tenant.firstName} ${lease.tenant.lastName}`
        : 'Unknown',
      monthlyRent: lease.rent.amount,
      currency: lease.rent.currency,
    }));
  }, [leasesData]);

  const filteredContracts = useMemo(() => {
    if (filter === 'all') return contracts;
    return contracts.filter((contract) => contract.status === filter);
  }, [contracts, filter]);

  const handleContractPress = (contractId: string) => {
    router.push(`/contracts/${contractId}`);
  };

  const handleAddNewContract = () => {
    router.push('/contracts/new');
  };

  if (!hasPropertiesLoading && !hasRentalProperties) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            title: t('Rental Contracts'),
            titlePosition: 'center',
          }}
        />
        <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
          <EmptyState
            icon="document-text-outline"
            title={t('No rental contracts')}
            description={t(
              "You don't have any rental properties yet. Start by browsing available properties or listing your own.",
            )}
            actionText={t('Browse properties')}
            actionIcon="home"
            onAction={() => router.push('/')}
          />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Header
        options={{
          title: t('Rental Contracts'),
          titlePosition: 'center',
        }}
      />
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.titleBlock}>
            <SectionEyebrow>Agreements</SectionEyebrow>
            <H2 style={styles.title}>{t('Rental Contracts')}</H2>
            <BloomText style={styles.subtitle}>
              {t(
                'Track every lease you sign or issue and pull up key terms in seconds.',
              )}
            </BloomText>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {FILTERS.map((entry) => {
              const isActive = filter === entry.id;
              return (
                <Chip
                  key={entry.id}
                  onPress={() => setFilter(entry.id)}
                  variant={isActive ? 'solid' : 'outlined'}
                  color={isActive ? 'primary' : 'default'}
                  selected={isActive}
                >
                  {t(entry.label)}
                </Chip>
              );
            })}
          </ScrollView>

          {leasesLoading || hasPropertiesLoading ? <ContractsSkeleton /> : null}

          {leasesError ? (
            <ErrorState
              icon="cloud-offline-outline"
              title={t("Couldn't load contracts")}
              description={String(leasesError) || t('Please try again.')}
              onRetry={() => refetchLeases()}
            />
          ) : null}

          {!leasesLoading && !leasesError && filteredContracts.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="document-text-outline"
                title={t('No contracts found')}
                description={
                  filter === 'all'
                    ? t("You don't have any rental contracts yet")
                    : t(`No ${filter.replace('_', ' ')} contracts to show`)
                }
                actionText={t('Create new contract')}
                actionIcon="add"
                onAction={handleAddNewContract}
              />
            </View>
          ) : null}

          {filteredContracts.length > 0 ? (
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

        <View style={styles.footer}>
          <Button
            variant="primary"
            size="large"
            onPress={handleAddNewContract}
            icon={<Ionicons name="add" size={20} color="#ffffff" />}
            style={styles.footerButton}
          >
            {t('New contract')}
          </Button>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['4xl'],
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
  listWrap: {
    gap: spacing.md,
  },
  skeletonCard: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.sm,
    ...withShadow('sm'),
  },
  skeletonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footer: {
    padding: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    ...withShadow('sm'),
  },
  footerButton: {
    alignSelf: 'stretch',
  },
});
