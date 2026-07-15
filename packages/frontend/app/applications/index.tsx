/**
 * My Applications — applicant-side list of long-term tenant applications.
 *
 * Polished to the Stream P personal-surface language:
 * - Bloom Chip filter row (All / Active / Decided / Withdrawn)
 * - Bloom Skeleton.Box list while loading (no spinner)
 * - Shared EmptyState / ErrorState components
 * - Bloom typography (H2, Text) for every label and title
 * - Date-grouped subhead so a long history breaks into Today / This week /
 *   Earlier instead of one wall of cards
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { isThisWeek, isToday } from 'date-fns';

import { Chip } from '@oxyhq/bloom/chip';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { useOxy, openAccountDialog } from '@oxyhq/services';
import {
  TenantApplication,
  TenantApplicationStatus,
} from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { ApplicationCard } from '@/components/ApplicationCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { useMyApplications } from '@/hooks/useApplicationQueries';
import { colors } from '@/styles/colors';
import { spacing, tracker } from '@/constants/styles';

type Filter = 'all' | 'active' | 'decided' | 'withdrawn';

interface FilterOption {
  value: Filter;
  i18nKey: string;
}

const FILTERS: FilterOption[] = [
  { value: 'all', i18nKey: 'applications.list.filterAll' },
  { value: 'active', i18nKey: 'applications.list.filterActive' },
  { value: 'decided', i18nKey: 'applications.list.filterDecided' },
  { value: 'withdrawn', i18nKey: 'applications.list.filterWithdrawn' },
];

interface Buckets {
  active: TenantApplication[];
  decided: TenantApplication[];
  withdrawn: TenantApplication[];
}

const bucketApplications = (items: TenantApplication[]): Buckets => {
  const buckets: Buckets = { active: [], decided: [], withdrawn: [] };
  for (const application of items) {
    if (
      application.status === TenantApplicationStatus.SUBMITTED ||
      application.status === TenantApplicationStatus.REVIEWING
    ) {
      buckets.active.push(application);
    } else if (application.status === TenantApplicationStatus.WITHDRAWN) {
      buckets.withdrawn.push(application);
    } else {
      buckets.decided.push(application);
    }
  }
  return buckets;
};

interface DateGroup {
  label: string;
  items: TenantApplication[];
}

/**
 * Group a list of applications by submission recency so the screen reads
 * Today → This week → Earlier instead of a single dense column.
 */
const groupByDate = (items: TenantApplication[], t: (key: string) => string): DateGroup[] => {
  const today: TenantApplication[] = [];
  const thisWeek: TenantApplication[] = [];
  const earlier: TenantApplication[] = [];

  for (const application of items) {
    const submittedAt = new Date(application.submittedAt);
    if (isToday(submittedAt)) {
      today.push(application);
    } else if (isThisWeek(submittedAt, { weekStartsOn: 1 })) {
      thisWeek.push(application);
    } else {
      earlier.push(application);
    }
  }

  return [
    { label: t('applications.list.today'), items: today },
    { label: t('applications.list.thisWeek'), items: thisWeek },
    { label: t('applications.list.earlier'), items: earlier },
  ].filter((group) => group.items.length > 0);
};

export default function MyApplicationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAuthenticated } = useOxy();
  const applicationsQuery = useMyApplications();
  const [filter, setFilter] = useState<Filter>('all');

  const buckets = useMemo(
    () => bucketApplications(applicationsQuery.data?.data ?? []),
    [applicationsQuery.data?.data],
  );

  const filtered = useMemo<TenantApplication[]>(() => {
    switch (filter) {
      case 'active':
        return buckets.active;
      case 'decided':
        return buckets.decided;
      case 'withdrawn':
        return buckets.withdrawn;
      default:
        return [...buckets.active, ...buckets.decided, ...buckets.withdrawn];
    }
  }, [filter, buckets]);

  const dateGroups = useMemo(() => groupByDate(filtered, t), [filtered, t]);

  const header = (
    <Header
      options={{
        showBackButton: true,
        title: t('applications.list.title'),
      }}
    />
  );

  if (!isAuthenticated) {
    return (
      <View style={styles.root}>
        {header}
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.centerWrap}>
            <EmptyState
              icon="document-text-outline"
              title={t('applications.list.signInTitle')}
              description={t('applications.list.signInDescription')}
              actionText={t('applications.list.signIn')}
              actionIcon="log-in-outline"
              onAction={() => openAccountDialog()}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (applicationsQuery.isPending) {
    return (
      <View style={styles.root}>
        {header}
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.content}>
            <FilterRow value={filter} onChange={setFilter} t={t} />
            <ListSkeleton rows={5} rowHeight={120} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (applicationsQuery.isError) {
    return (
      <View style={styles.root}>
        {header}
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.centerWrap}>
            <ErrorState
              title={t('applications.list.loadError')}
              description={
                applicationsQuery.error?.message ?? t('applications.list.tryAgain')
              }
              retryLabel={t('applications.list.retry')}
              onRetry={() => applicationsQuery.refetch()}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {header}
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <FilterRow value={filter} onChange={setFilter} />

          {filtered.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="document-text-outline"
                title={
                  filter === 'all'
                    ? t('applications.list.emptyAllTitle')
                    : t('applications.list.emptyFilteredTitle')
                }
                description={
                  filter === 'all'
                    ? t('applications.list.emptyAllDescription')
                    : t('applications.list.emptyFilteredDescription')
                }
                actionText={filter === 'all' ? t('applications.list.exploreStays') : undefined}
                actionIcon={filter === 'all' ? 'search-outline' : undefined}
                onAction={
                  filter === 'all' ? () => router.push('/explore') : undefined
                }
              />
            </View>
          ) : (
            dateGroups.map((group) => (
              <View key={group.label} style={styles.section}>
                <BloomText style={styles.sectionEyebrow}>{group.label}</BloomText>
                <View style={styles.cards}>
                  {group.items.map((application) => (
                    <ApplicationCard
                      key={application.id}
                      application={application}
                    />
                  ))}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

interface FilterRowProps {
  value: Filter;
  onChange: (next: Filter) => void;
  t: (key: string) => string;
}

const FilterRow: React.FC<FilterRowProps> = ({ value, onChange, t }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.filterRow}
  >
    {FILTERS.map((option) => (
      <Chip
        key={option.value}
        variant={value === option.value ? 'solid' : 'outlined'}
        color={value === option.value ? 'primary' : 'default'}
        size="medium"
        selected={value === option.value}
        onPress={() => onChange(option.value)}
      >
        {t(option.i18nKey)}
      </Chip>
    ))}
  </ScrollView>
);

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
    gap: spacing['2xl'],
  },
  centerWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyWrap: {
    paddingVertical: spacing['3xl'],
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  section: {
    gap: spacing.md,
  },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: tracker.eyebrow,
  },
  cards: {
    gap: spacing.md,
  },
});
