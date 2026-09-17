/**
 * Roommates discovery hub — tabbed view of matches / requests / relationships
 * / room listings.
 *
 * Stream Q polish:
 *   - Bloom Typography (H1/H2/H3/Text) replaces RN Text.
 *   - Bloom Button replaces TouchableOpacity CTAs.
 *   - Tab bar is Bloom `Tabs` (pill variant, Remix leading icons).
 *   - Feedback is Bloom `toast`.
 *   - Shared EmptyState + Loading (Bloom) component.
 *   - Flat wrappers (hairline border) around list content.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@oxy.so/bloom/button';
import {
  RiGroupLine,
  RiHotelBedLine,
  RiMailLine,
  RiSearchLine,
  RiSettings3Line,
} from '@oxy.so/bloom/icons';
import { Tabs, TabsTrigger, type TabsIconComponent } from '@oxy.so/bloom/tabs';
import { toast } from '@oxy.so/bloom/toast';
import { Loading } from '@oxy.so/bloom/loading';
import { H1 } from '@oxy.so/bloom/typography';
import { useOxy } from '@oxy.so/services';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { RoommateMatch } from '@/components/RoommateMatch';
import { RoommateRequestComponent } from '@/components/RoommateRequest';
import { RoommateRelationshipComponent } from '@/components/RoommateRelationship';
import { RoomList } from '@/components/RoomList';
import { useProfile } from '@/context/ProfileContext';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { useRoommate } from '@/hooks/useRoommate';
import { roommateService } from '@/services/roommateService';
import { type PropertyFilters } from '@/services/propertyService';
import { useProfileStore } from '@/store/profileStore';
import { spacing } from '@/constants/styles';
import { colors } from '@/styles/colors';

type Tab = 'discover' | 'requests' | 'relationships' | 'rooms';

const TAB_IDS: { id: Tab; icon: TabsIconComponent; labelKey: string }[] = [
  { id: 'discover', labelKey: 'roommates.tabs.discover', icon: RiSearchLine },
  { id: 'requests', labelKey: 'roommates.tabs.requests', icon: RiMailLine },
  { id: 'relationships', labelKey: 'roommates.tabs.matches', icon: RiGroupLine },
  { id: 'rooms', labelKey: 'roommates.tabs.rooms', icon: RiHotelBedLine },
];

const isTab = (value: string): value is Tab => TAB_IDS.some((entry) => entry.id === value);

export default function RoommatesPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('discover');
  // On a phone the four icons alone cost ~96px, which is what pushed the last
  // tab off a 390px screen. Labels carry the meaning; longer translations still
  // scroll, and Bloom `Tabs` centres the selected trigger when they do.
  const isWide = useIsScreenNotMobile();
  const [isToggling, setIsToggling] = useState(false);

  const {
    profiles,
    requests,
    relationships,
    isLoading,
    error,
    fetchProfiles,
    fetchRequests,
    fetchRelationships,
    sendRequest,
    acceptRequest,
    declineRequest,
    endRelationship,
  } = useRoommate();

  const { profile, hasProfile } = useProfile();

  const statusQuery = useQuery({
    queryKey: ['roommates', 'status'],
    queryFn: async () =>
      roommateService.getMyRoommateStatus(oxyServices, activeSessionId ?? undefined),
    enabled: Boolean(oxyServices && activeSessionId),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });

  const computedEnabledFromProfile = Boolean(
    hasProfile && profile?.personalProfile?.settings?.roommate?.enabled,
  );

  const hasRoommateMatching = Boolean(
    statusQuery.data?.hasRoommateMatching ?? computedEnabledFromProfile,
  );

  // Tab-driven fetch (kept as effect since data is owned by the legacy hook)
  useEffect(() => {
    if (!hasProfile || !hasProfile) return;
    switch (activeTab) {
      case 'discover':
        fetchProfiles();
        break;
      case 'requests':
        fetchRequests();
        break;
      case 'relationships':
        fetchRelationships();
        break;
      default:
        break;
    }
    // useRoommate fns are stable but lint can't always see that
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, hasProfile, hasProfile]);

  // When the user just enabled matching, refresh the discover list
  useEffect(() => {
    if (hasRoommateMatching && activeTab === 'discover') {
      fetchProfiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRoommateMatching]);

  // Auth-bound re-fetch on first mount so we don't race the auth context
  useEffect(() => {
    if (!oxyServices || !activeSessionId) return;
    if (!hasProfile || !hasProfile) return;
    useProfileStore.getState().fetchProfile();
    if (activeTab === 'discover') fetchProfiles();
    if (activeTab === 'requests') fetchRequests();
    if (activeTab === 'relationships') fetchRelationships();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oxyServices, activeSessionId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      switch (activeTab) {
        case 'discover':
          await fetchProfiles();
          break;
        case 'requests':
          await fetchRequests();
          break;
        case 'relationships':
          await fetchRelationships();
          break;
        default:
          break;
      }
    } finally {
      setRefreshing(false);
    }
  }, [activeTab, fetchProfiles, fetchRequests, fetchRelationships]);

  const personalProfileEmpty = (
    <EmptyState
      icon="person-outline"
      title={t('roommates.screen.personalProfileRequired')}
      description={t('roommates.screen.personalProfileDescription')}
      actionText={t('roommates.screen.switchToPersonal')}
      actionIcon="person-circle"
      onAction={() => router.push('/profile')}
    />
  );

  const handleToggleMatching = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;
    if (isToggling) return;
    setIsToggling(true);
    try {
      const intendedState = !hasRoommateMatching;
      const result = await roommateService.toggleRoommateMatching(
        intendedState,
        oxyServices,
        activeSessionId,
      );
      await useProfileStore.getState().fetchProfile();
      queryClient.setQueryData(['roommates', 'status'], {
        hasRoommateMatching: result.enabled,
      });
      if (result.enabled) {
        fetchProfiles();
      }
      toast.success(
        result.message ||
          (result.enabled
            ? t('roommates.screen.matchingEnabled')
            : t('roommates.screen.matchingDisabled')),
      );
    } catch {
      toast.error(t('roommates.alert.toggleFailed'));
    } finally {
      setIsToggling(false);
    }
  }, [
    oxyServices,
    activeSessionId,
    isToggling,
    hasRoommateMatching,
    queryClient,
    fetchProfiles,
    t,
  ]);

  const handleViewProfile = (profileId: string) => {
    router.push(`/roommates/${profileId}`);
  };

  const preferencesQuery = useQuery({
    queryKey: ['roommates', 'preferences'],
    queryFn: async () =>
      roommateService.getMyRoommatePreferences(
        oxyServices,
        activeSessionId ?? undefined,
      ),
    enabled: Boolean(oxyServices && activeSessionId),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });

  const [roomFilters, setRoomFilters] = useState<PropertyFilters>({});

  // Seed the price range from the user's saved roommate preferences once the
  // query resolves. Implemented with React's "adjust state when a tracked value
  // changes" pattern instead of an effect to avoid cascading renders; the user
  // can still adjust the filters afterwards.
  const preferencesData = preferencesQuery.data;
  const [prevPreferencesData, setPrevPreferencesData] = useState(preferencesData);
  if (preferencesData !== prevPreferencesData) {
    setPrevPreferencesData(preferencesData);
    if (preferencesData?.budget) {
      setRoomFilters((prev: PropertyFilters) => ({
        ...prev,
        minPrice: preferencesData.budget?.min,
        maxPrice: preferencesData.budget?.max,
      }));
    }
  }

  const renderDiscoverTab = () => {
    if (!hasProfile || !hasProfile) {
      return personalProfileEmpty;
    }

    if (isLoading) {
      return (
        <View style={styles.loadingWrap}>
          <Loading variant="spinner" />
        </View>
      );
    }

    if (error && profiles.length === 0) {
      return (
        <ErrorState
          title={t('roommates.screen.loadError')}
          description={error}
          onRetry={fetchProfiles}
        />
      );
    }

    if (!hasRoommateMatching && profiles.length === 0) {
      return (
        <EmptyState
          icon="people-outline"
          title={t('roommates.screen.enableMatchingTitle')}
          description={t('roommates.screen.enableMatchingDescription')}
          actionText={isToggling ? t('roommates.screen.enabling') : t('roommates.screen.enableMatching')}
          actionIcon="checkmark-circle"
          onAction={handleToggleMatching}
        />
      );
    }

    if (profiles.length === 0) {
      return (
        <EmptyState
          icon="people-outline"
          title={t('roommates.screen.emptyDiscoverTitle')}
          description={t('roommates.screen.emptyDiscoverDescription')}
          actionText={t('roommates.screen.updatePreferences')}
          actionIcon="settings"
          onAction={() => router.push('/roommates/preferences')}
        />
      );
    }

    return (
      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {profiles.map((profile) => (
          <RoommateMatch
            key={profile.id}
            profile={profile}
            onSendRequest={sendRequest}
            onViewProfile={handleViewProfile}
          />
        ))}
      </ScrollView>
    );
  };

  const renderRequestsTab = () => {
    if (!hasProfile || !hasProfile) {
      return personalProfileEmpty;
    }

    if (isLoading) {
      return (
        <View style={styles.loadingWrap}>
          <Loading variant="spinner" />
        </View>
      );
    }

    if (error && requests.sent.length === 0 && requests.received.length === 0) {
      return (
        <ErrorState
          title={t('roommates.screen.loadRequestsError')}
          description={error}
          onRetry={fetchRequests}
        />
      );
    }

    if (requests.sent.length === 0 && requests.received.length === 0) {
      return (
        <EmptyState
          icon="mail-outline"
          title={t('roommates.screen.emptyRequestsTitle')}
          description={t('roommates.screen.emptyRequestsDescription')}
          actionText={t('roommates.screen.discoverRoommates')}
          actionIcon="search"
          onAction={() => setActiveTab('discover')}
        />
      );
    }

    return (
      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {requests.received.map((request) => (
          <RoommateRequestComponent
            key={request.id}
            request={request}
            type="received"
            onAccept={acceptRequest}
            onDecline={declineRequest}
            onViewProfile={handleViewProfile}
          />
        ))}
        {requests.sent.map((request) => (
          <RoommateRequestComponent
            key={request.id}
            request={request}
            type="sent"
            onViewProfile={handleViewProfile}
          />
        ))}
      </ScrollView>
    );
  };

  const renderRelationshipsTab = () => {
    if (!hasProfile || !hasProfile) {
      return personalProfileEmpty;
    }

    if (isLoading) {
      return (
        <View style={styles.loadingWrap}>
          <Loading variant="spinner" />
        </View>
      );
    }

    if (error && relationships.length === 0) {
      return (
        <ErrorState
          title={t('roommates.screen.loadRelationshipsError')}
          description={error}
          onRetry={fetchRelationships}
        />
      );
    }

    if (relationships.length === 0) {
      return (
        <EmptyState
          icon="people-circle-outline"
          title={t('roommates.screen.emptyRelationshipsTitle')}
          description={t('roommates.screen.emptyRelationshipsDescription')}
          actionText={t('roommates.screen.discoverRoommates')}
          actionIcon="search"
          onAction={() => setActiveTab('discover')}
        />
      );
    }

    return (
      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {relationships.map((relationship) => (
          <RoommateRelationshipComponent
            key={relationship.id}
            relationship={relationship}
            onEndRelationship={endRelationship}
            onViewProfile={handleViewProfile}
          />
        ))}
      </ScrollView>
    );
  };

  const renderRoomsTab = () => {
    if (!hasProfile || !hasProfile) {
      return (
        <EmptyState
          icon="person-outline"
          title={t('roommates.screen.personalProfileRequired')}
          description={t('roommates.screen.roomSearchPersonalOnly')}
          actionText={t('roommates.screen.switchToPersonal')}
          actionIcon="person-circle"
          onAction={() => router.push('/profile')}
        />
      );
    }

    return (
      <View style={styles.roomsWrap}>
        <RoomList filters={roomFilters} onFilterChange={setRoomFilters} />
      </View>
    );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'discover':
        return renderDiscoverTab();
      case 'requests':
        return renderRequestsTab();
      case 'relationships':
        return renderRelationshipsTab();
      case 'rooms':
        return renderRoomsTab();
      default:
        return renderDiscoverTab();
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.headerWrap}>
        <View style={styles.headerInner}>
          <View style={styles.titleBlock}>
            <SectionEyebrow>{t('roommates.screen.eyebrow')}</SectionEyebrow>
            <H1 style={styles.title}>{t('roommates.screen.title')}</H1>
          </View>
          <Button
            variant="secondary"
            size="small"
            onPress={() => router.push('/roommates/preferences')}
            leadingIcon={RiSettings3Line}
            iconOnly={!isWide}
            accessibilityLabel={t('roommates.preferences')}
            style={styles.headerAction}
          >
            {isWide ? t('roommates.preferences') : null}
          </Button>
        </View>
        <Tabs
          variant="pill"
          value={activeTab}
          onValueChange={(value) => {
            if (isTab(value)) setActiveTab(value);
          }}
        >
          {TAB_IDS.map((entry) => (
            <TabsTrigger
              key={entry.id}
              value={entry.id}
              label={t(entry.labelKey)}
              leadingIcon={isWide ? entry.icon : undefined}
            />
          ))}
        </Tabs>
      </SafeAreaView>

      <View style={styles.content}>{renderTabContent()}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerWrap: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  headerAction: {
    flexShrink: 0,
  },
  title: {
    letterSpacing: -0.5,
  },
  content: {
    flex: 1,
    padding: spacing.lg,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['3xl'],
  },
  listContent: {
    gap: spacing.md,
    paddingBottom: spacing['3xl'],
  },
  roomsWrap: {
    flex: 1,
    marginHorizontal: -spacing.lg,
  },
});
