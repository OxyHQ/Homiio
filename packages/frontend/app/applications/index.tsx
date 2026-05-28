/**
 * My Applications — applicant-side list of long-term tenant applications.
 * Groups by lifecycle bucket (Active = submitted/reviewing, Decided = approved
 * or rejected, Withdrawn).
 */
import React, { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import { Button } from '@oxyhq/bloom/button';
import { useOxy, showSignInModal } from '@oxyhq/services';
import {
  TenantApplication,
  TenantApplicationStatus,
} from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { ApplicationCard } from '@/components/ApplicationCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { useMyApplications } from '@/hooks/useApplicationQueries';
import { colors } from '@/styles/colors';

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

export default function MyApplicationsScreen() {
  const router = useRouter();
  const { isAuthenticated } = useOxy();
  const applicationsQuery = useMyApplications();

  const buckets = useMemo(
    () => bucketApplications(applicationsQuery.data?.data ?? []),
    [applicationsQuery.data?.data],
  );

  if (!isAuthenticated) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: 'My applications',
            titlePosition: 'center',
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.emptyWrapper}>
            <EmptyState
              icon="document-text-outline"
              title="Sign in to see your applications"
              description="Track tenant applications you've sent to landlords."
              actionText="Sign in"
              actionIcon="log-in-outline"
              onAction={() => showSignInModal()}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (applicationsQuery.isPending) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: 'My applications',
            titlePosition: 'center',
          }}
        />
        <View style={styles.loadingWrapper}>
          <ActivityIndicator color={colors.primaryColor} />
        </View>
      </View>
    );
  }

  if (applicationsQuery.isError) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: 'My applications',
            titlePosition: 'center',
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.errorWrap}>
            <BloomText style={styles.errorTitle}>
              Couldn&apos;t load your applications
            </BloomText>
            <BloomText style={styles.errorSubtitle}>
              {applicationsQuery.error?.message ?? 'Please try again.'}
            </BloomText>
            <Button
              variant="primary"
              size="medium"
              onPress={() => applicationsQuery.refetch()}
            >
              Retry
            </Button>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const hasItems =
    buckets.active.length + buckets.decided.length + buckets.withdrawn.length > 0;

  return (
    <View style={styles.root}>
      <Header
        options={{
          showBackButton: true,
          title: 'My applications',
          titlePosition: 'center',
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          {!hasItems ? (
            <EmptyState
              icon="document-text-outline"
              title="No applications yet."
              description="Browse listings and submit an application to a long-term rental."
              actionText="Explore stays"
              actionIcon="search-outline"
              onAction={() => router.push('/search')}
            />
          ) : null}
          {buckets.active.length > 0 ? (
            <Section title="Active" items={buckets.active} />
          ) : null}
          {buckets.decided.length > 0 ? (
            <Section title="Decided" items={buckets.decided} />
          ) : null}
          {buckets.withdrawn.length > 0 ? (
            <Section title="Withdrawn" items={buckets.withdrawn} />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

interface SectionProps {
  title: string;
  items: TenantApplication[];
}

const Section: React.FC<SectionProps> = ({ title, items }) => (
  <View style={styles.section}>
    <H3 style={styles.sectionTitle}>{title}</H3>
    {items.map((application) => (
      <ApplicationCard key={application.id} application={application} />
    ))}
  </View>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.primaryLight,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  emptyWrapper: {
    flex: 1,
    justifyContent: 'center',
  },
  loadingWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  errorSubtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
  },
  section: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
});
