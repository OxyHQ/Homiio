/**
 * Contracts inbox — leases the user signs (tenant) or holds (landlord).
 *
 * Stream Q polish:
 *   - Bloom Chip filter row, Bloom Button "New contract" CTA in the header.
 *   - Flat ContractCard list with radius.lg + hairline borders.
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
import type { Profile } from '@homiio/shared-types';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
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

type FilterOption = 'all' | 'active' | 'pending_signatures' | 'expired' | 'draft';

const FILTERS: { id: FilterOption; i18nKey: string }[] = [
  { id: 'all', i18nKey: 'contracts.list.filterAll' },
  { id: 'active', i18nKey: 'contracts.list.filterActive' },
  { id: 'pending_signatures', i18nKey: 'contracts.list.filterPending' },
  { id: 'expired', i18nKey: 'contracts.list.filterExpired' },
  { id: 'draft', i18nKey: 'contracts.list.filterDrafts' },
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
            title: t('contracts.list.title'),
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <EmptyState
            icon="document-text-outline"
            title={t('contracts.list.noRentalPropertiesTitle')}
            description={t('contracts.list.noRentalPropertiesDescription')}
            actionText={t('contracts.list.browseProperties')}
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
          title: t('contracts.list.title'),
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.titleBlock}>
            <SectionEyebrow>{t('contracts.list.eyebrow')}</SectionEyebrow>
            <H2 style={styles.title}>{t('contracts.list.title')}</H2>
            <BloomText style={styles.subtitle}>{t('contracts.list.subtitle')}</BloomText>
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
                  {t(entry.i18nKey)}
                </Chip>
              );
            })}
          </ScrollView>

          {leasesLoading || hasPropertiesLoading ? <ContractsSkeleton /> : null}

          {leasesError ? (
            <ErrorState
              icon="cloud-offline-outline"
              title={t('contracts.list.loadError')}
              description={leasesError?.message || t('contracts.list.tryAgain')}
              onRetry={() => refetchLeases()}
            />
          ) : null}

          {!leasesLoading && !leasesError && filteredContracts.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="document-text-outline"
                title={t('contracts.list.emptyTitle')}
                description={
                  filter === 'all'
                    ? t('contracts.list.emptyAllDescription')
                    : t('contracts.list.emptyFilteredDescription', {
                        filter: t(
                          `statusBadge.${filter === 'pending_signatures' ? 'pendingSignatures' : filter}`,
                        ),
                      })
                }
                actionText={t('contracts.list.createNew')}
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
            icon={<Ionicons name="add" size={20} color={colors.primaryForeground} />}
            style={styles.footerButton}
          >
            {t('contracts.list.newContract')}
          </Button>
        </View>
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
