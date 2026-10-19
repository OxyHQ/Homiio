/**
 * My Applications — applicant-side list of long-term tenant applications.
 *
 * Polished to the Stream P personal-surface language:
 * - Bloom SegmentedControl filter (All / Active / Decided / Withdrawn)
 * - Bloom Skeleton.Box list while loading (no spinner)
 * - Shared EmptyState / ErrorState components
 * - Bloom typography (H2, Text) for every label and title
 * - Date-grouped subhead so a long history breaks into Today / This week /
 *   Earlier instead of one wall of cards
 */
import type React from 'react';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { isThisWeek, isToday } from 'date-fns';

import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxy.so/bloom/segmented-control';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { useOxy } from '@oxy.so/services/ui/client';
import { type TenantApplication, TenantApplicationStatus } from '@homiio/shared-types';

import { ApplicationCard } from '@/components/ApplicationCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { useMyApplications } from '@/hooks/useApplicationQueries';
import { spacing, tracker } from '@/constants/styles';
import { RiFileTextLine, RiLoginBoxLine, RiSearchLine } from '@oxy.so/bloom/icons';

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
  const theme = useTheme();
  const { isAuthenticated, openAccountDialog } = useOxy();
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
    <PageHeader
      title={t('applications.list.title')}
      titleAlign="center"
      leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
      onBack={router.canGoBack() ? router.back : undefined}
      backLabel={t('goBack')}
    />
  );

  if (!isAuthenticated) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView contentContainerStyle={styles.centerWrap}>
          <EmptyState
            icon={RiFileTextLine}
            title={t('applications.list.signInTitle')}
            description={t('applications.list.signInDescription')}
            actionText={t('applications.list.signIn')}
            actionIcon={RiLoginBoxLine}
            onAction={() => openAccountDialog()}
          />
        </ScreenScrollView>
      </Screen>
    );
  }

  if (applicationsQuery.isPending) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView contentContainerStyle={styles.content}>
          <FilterRow value={filter} onChange={setFilter} t={t} />
          <ListSkeleton rows={5} rowHeight={120} />
        </ScreenScrollView>
      </Screen>
    );
  }

  if (applicationsQuery.isError) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView contentContainerStyle={styles.centerWrap}>
          <ErrorState
            title={t('applications.list.loadError')}
            description={applicationsQuery.error?.message ?? t('applications.list.tryAgain')}
            retryLabel={t('applications.list.retry')}
            onRetry={() => applicationsQuery.refetch()}
          />
        </ScreenScrollView>
      </Screen>
    );
  }

  return (
    <Screen documentScroll header={header}>
      <ScreenScrollView contentContainerStyle={styles.content}>
        <FilterRow value={filter} onChange={setFilter} t={t} />

        {filtered.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon={RiFileTextLine}
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
              actionIcon={filter === 'all' ? RiSearchLine : undefined}
              onAction={filter === 'all' ? () => router.push('/explore') : undefined}
            />
          </View>
        ) : (
          dateGroups.map((group) => (
            <View key={group.label} style={styles.section}>
              <BloomText style={[styles.sectionEyebrow, { color: theme.colors.textSecondary }]}>
                {group.label}
              </BloomText>
              <View style={styles.cards}>
                {group.items.map((application) => (
                  <ApplicationCard key={application.id} application={application} />
                ))}
              </View>
            </View>
          ))
        )}
      </ScreenScrollView>
    </Screen>
  );
}

interface FilterRowProps {
  value: Filter;
  onChange: (next: Filter) => void;
  t: (key: string) => string;
}

const FilterRow: React.FC<FilterRowProps> = ({ value, onChange, t }) => (
  <SegmentedControl<Filter>
    label={t('applications.list.title')}
    type="tabs"
    value={value}
    onChange={onChange}
  >
    {FILTERS.map((option) => (
      <SegmentedControlItem key={option.value} value={option.value}>
        <SegmentedControlItemText>{t(option.i18nKey)}</SegmentedControlItemText>
      </SegmentedControlItem>
    ))}
  </SegmentedControl>
);

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing['2xl'],
  },
  centerWrap: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyWrap: {
    paddingVertical: spacing['3xl'],
  },
  section: {
    gap: spacing.md,
  },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: tracker.eyebrow,
  },
  cards: {
    gap: spacing.md,
  },
});
