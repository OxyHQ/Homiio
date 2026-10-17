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
import { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@oxy.so/bloom/button';
import {
  RiAccountCircleLine,
  RiCheckboxCircleFill,
  RiGroupLine,
  RiHotelBedLine,
  RiMailLine,
  RiSearchLine,
  RiSettings3Line,
  RiUserCommunityLine,
  RiUserLine,
} from '@oxy.so/bloom/icons';
import { Tabs, TabsTrigger, type TabsIconComponent } from '@oxy.so/bloom/tabs';
import { toast } from '@oxy.so/bloom/toast';
import { Loading } from '@oxy.so/bloom/loading';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
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
import { useRoomsFeed } from '@/hooks/useRoomsFeed';
import {
  useRoommate,
  type RoommateProfile,
  type RoommateRelationship,
  type RoommateRequest,
} from '@/hooks/useRoommate';
import { roommateService } from '@/services/roommateService';
import type { PropertyFilters } from '@/services/propertyService';
import { useProfileStore } from '@/store/profileStore';
import { spacing } from '@/constants/styles';

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
  const [activeTab, setActiveTab] = useState<Tab>('discover');
  const [isToggling, setIsToggling] = useState(false);

  // The legacy hook is used for its mutations only; each one invalidates the
  // `['roommates', …]` lists below, which refetch themselves.
  const { sendRequest, acceptRequest, declineRequest, endRelationship } = useRoommate();

  const { profile, hasProfile } = useProfile();

  // Each tab's list is a query that runs while its tab is open (the profile
  // itself is loaded once per session by `ProfileContext`). Keyed on the
  // session so switching account never shows the previous one's lists.
  const canLoadLists = Boolean(oxyServices && activeSessionId && hasProfile);
  const listQueryOptions = { staleTime: 1000 * 30, gcTime: 1000 * 60 * 10 } as const;

  const profilesQuery = useQuery({
    queryKey: ['roommates', 'profiles', activeSessionId],
    queryFn: async () => {
      const response = await roommateService.getRoommateProfiles();
      return (response.profiles || []) as RoommateProfile[];
    },
    enabled: canLoadLists && activeTab === 'discover',
    ...listQueryOptions,
  });

  const requestsQuery = useQuery({
    queryKey: ['roommates', 'requests', activeSessionId],
    queryFn: async () => {
      const response = await roommateService.getRoommateRequests();
      return {
        sent: (response?.sent ?? []) as RoommateRequest[],
        received: (response?.received ?? []) as RoommateRequest[],
      };
    },
    enabled: canLoadLists && activeTab === 'requests',
    ...listQueryOptions,
  });

  const relationshipsQuery = useQuery({
    queryKey: ['roommates', 'relationships', activeSessionId],
    queryFn: async () => {
      const response = await roommateService.getRoommateRelationships();
      return (response.data || []) as RoommateRelationship[];
    },
    enabled: canLoadLists && activeTab === 'relationships',
    ...listQueryOptions,
  });

  const profiles = profilesQuery.data ?? [];
  const requests = requestsQuery.data ?? { sent: [], received: [] };
  const relationships = relationshipsQuery.data ?? [];

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

  const personalProfileEmpty = (
    <EmptyState
      icon={RiUserLine}
      title={t('roommates.screen.personalProfileRequired')}
      description={t('roommates.screen.personalProfileDescription')}
      actionText={t('roommates.screen.switchToPersonal')}
      actionIcon={RiAccountCircleLine}
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
        // Newly visible to matching: the discover list changes with it.
        await queryClient.invalidateQueries({ queryKey: ['roommates', 'profiles'] });
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
  }, [oxyServices, activeSessionId, isToggling, hasRoommateMatching, queryClient, t]);

  const handleViewProfile = (profileId: string) => {
    router.push(`/roommates/${profileId}`);
  };

  const preferencesQuery = useQuery({
    queryKey: ['roommates', 'preferences'],
    queryFn: async () =>
      roommateService.getMyRoommatePreferences(oxyServices, activeSessionId ?? undefined),
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

  const showRooms = activeTab === 'rooms' && hasProfile;
  const roomsFeed = useRoomsFeed(roomFilters, showRooms);

  const renderDiscoverTab = () => {
    if (!hasProfile || !hasProfile) {
      return personalProfileEmpty;
    }

    if (profilesQuery.isLoading) {
      return (
        <View style={styles.loadingWrap}>
          <Loading variant="spinner" />
        </View>
      );
    }

    if (profilesQuery.isError && profiles.length === 0) {
      return (
        <ErrorState
          title={t('roommates.screen.loadError')}
          description={profilesQuery.error.message}
          onRetry={() => void profilesQuery.refetch()}
        />
      );
    }

    if (!hasRoommateMatching && profiles.length === 0) {
      return (
        <EmptyState
          icon={RiGroupLine}
          title={t('roommates.screen.enableMatchingTitle')}
          description={t('roommates.screen.enableMatchingDescription')}
          actionText={
            isToggling ? t('roommates.screen.enabling') : t('roommates.screen.enableMatching')
          }
          actionIcon={RiCheckboxCircleFill}
          onAction={handleToggleMatching}
        />
      );
    }

    if (profiles.length === 0) {
      return (
        <EmptyState
          icon={RiGroupLine}
          title={t('roommates.screen.emptyDiscoverTitle')}
          description={t('roommates.screen.emptyDiscoverDescription')}
          actionText={t('roommates.screen.updatePreferences')}
          actionIcon={RiSettings3Line}
          onAction={() => router.push('/roommates/preferences')}
        />
      );
    }

    return (
      <View style={styles.listContent}>
        {profiles.map((profile) => (
          <RoommateMatch
            key={profile.id}
            profile={profile}
            onSendRequest={sendRequest}
            onViewProfile={handleViewProfile}
          />
        ))}
      </View>
    );
  };

  const renderRequestsTab = () => {
    if (!hasProfile || !hasProfile) {
      return personalProfileEmpty;
    }

    if (requestsQuery.isLoading) {
      return (
        <View style={styles.loadingWrap}>
          <Loading variant="spinner" />
        </View>
      );
    }

    if (requestsQuery.isError && requests.sent.length === 0 && requests.received.length === 0) {
      return (
        <ErrorState
          title={t('roommates.screen.loadRequestsError')}
          description={requestsQuery.error.message}
          onRetry={() => void requestsQuery.refetch()}
        />
      );
    }

    if (requests.sent.length === 0 && requests.received.length === 0) {
      return (
        <EmptyState
          icon={RiMailLine}
          title={t('roommates.screen.emptyRequestsTitle')}
          description={t('roommates.screen.emptyRequestsDescription')}
          actionText={t('roommates.screen.discoverRoommates')}
          actionIcon={RiSearchLine}
          onAction={() => setActiveTab('discover')}
        />
      );
    }

    return (
      <View style={styles.listContent}>
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
      </View>
    );
  };

  const renderRelationshipsTab = () => {
    if (!hasProfile || !hasProfile) {
      return personalProfileEmpty;
    }

    if (relationshipsQuery.isLoading) {
      return (
        <View style={styles.loadingWrap}>
          <Loading variant="spinner" />
        </View>
      );
    }

    if (relationshipsQuery.isError && relationships.length === 0) {
      return (
        <ErrorState
          title={t('roommates.screen.loadRelationshipsError')}
          description={relationshipsQuery.error.message}
          onRetry={() => void relationshipsQuery.refetch()}
        />
      );
    }

    if (relationships.length === 0) {
      return (
        <EmptyState
          icon={RiUserCommunityLine}
          title={t('roommates.screen.emptyRelationshipsTitle')}
          description={t('roommates.screen.emptyRelationshipsDescription')}
          actionText={t('roommates.screen.discoverRoommates')}
          actionIcon={RiSearchLine}
          onAction={() => setActiveTab('discover')}
        />
      );
    }

    return (
      <View style={styles.listContent}>
        {relationships.map((relationship) => (
          <RoommateRelationshipComponent
            key={relationship.id}
            relationship={relationship}
            onEndRelationship={endRelationship}
            onViewProfile={handleViewProfile}
          />
        ))}
      </View>
    );
  };

  const renderRoomsTab = () => {
    if (!hasProfile || !hasProfile) {
      return (
        <EmptyState
          icon={RiUserLine}
          title={t('roommates.screen.personalProfileRequired')}
          description={t('roommates.screen.roomSearchPersonalOnly')}
          actionText={t('roommates.screen.switchToPersonal')}
          actionIcon={RiAccountCircleLine}
          onAction={() => router.push('/profile')}
        />
      );
    }

    return (
      <View style={styles.roomsWrap}>
        <RoomList feed={roomsFeed} filters={roomFilters} onFilterChange={setRoomFilters} />
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

  const titleBlock = (
    <View className="bg-card px-4 pb-3 gap-3 border-b border-border">
      <View style={styles.headerInner}>
        <View style={styles.titleBlock}>
          <SectionEyebrow>{t('roommates.screen.eyebrow')}</SectionEyebrow>
          <H1 style={styles.title}>{t('roommates.screen.title')}</H1>
        </View>
        <View style={styles.headerAction} className="sm:hidden">
          <Button
            size="sm"
            onPress={() => router.push('/roommates/preferences')}
            leadingIcon={RiSettings3Line}
            iconOnly
            accessibilityLabel={t('roommates.preferences')}
            tone="neutral"
            appearance="outline"
          />
        </View>
        <View style={styles.headerAction} className="hidden sm:flex">
          <Button
            size="sm"
            onPress={() => router.push('/roommates/preferences')}
            leadingIcon={RiSettings3Line}
            accessibilityLabel={t('roommates.preferences')}
            tone="neutral"
            appearance="outline"
          >
            {t('roommates.preferences')}
          </Button>
        </View>
      </View>
      {/* On a phone the four icons alone cost ~96px, which is what pushed the
          last tab off a 390px screen. Labels carry the meaning; longer
          translations still scroll, and Bloom `Tabs` centres the selected
          trigger when they do. */}
      <View className="sm:hidden">
        <Tabs
          variant="pill"
          value={activeTab}
          onValueChange={(value) => {
            if (isTab(value)) setActiveTab(value);
          }}
        >
          {TAB_IDS.map((entry) => (
            <TabsTrigger key={entry.id} value={entry.id} label={t(entry.labelKey)} />
          ))}
        </Tabs>
      </View>
      <View className="hidden sm:flex">
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
              leadingIcon={entry.icon}
            />
          ))}
        </Tabs>
      </View>
    </View>
  );

  const tabContent = <View style={styles.content}>{renderTabContent()}</View>;

  // The page owns the one scroller: on the Rooms tab it paginates and refreshes
  // the room feed, which `RoomList` only renders.
  return (
    <Screen documentScroll>
      <ScreenScrollView
        onEndReached={showRooms ? roomsFeed.loadMore : undefined}
        refreshControl={
          showRooms ? (
            <RefreshControl refreshing={roomsFeed.refreshing} onRefresh={roomsFeed.refresh} />
          ) : undefined
        }
      >
        {titleBlock}
        {tabContent}
      </ScreenScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
