/**
 * Roommates discovery hub — tabbed view of matches / requests / relationships
 * / room listings.
 *
 * Stream Q polish:
 *   - Bloom Typography (H1/H2/H3/Text) replaces RN Text.
 *   - Bloom Button replaces TouchableOpacity CTAs.
 *   - Tab bar uses semantic tokens + Pressable + Bloom Text instead of
 *     raw TouchableOpacity.
 *   - Shared EmptyState + Loading (Bloom) component.
 *   - withShadow('sm') wrappers around list content.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import { Loading } from '@oxyhq/bloom/loading';
import { H1, Text as BloomText } from '@oxyhq/bloom/typography';
import { useOxy } from '@oxyhq/services';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { RoommateMatch } from '@/components/RoommateMatch';
import { RoommateRequestComponent } from '@/components/RoommateRequest';
import { RoommateRelationshipComponent } from '@/components/RoommateRelationship';
import { RoomList } from '@/components/RoomList';
import { useProfile } from '@/context/ProfileContext';
import { useRoommate } from '@/hooks/useRoommate';
import { roommateService } from '@/services/roommateService';
import { type PropertyFilters } from '@/services/propertyService';
import { useProfileStore } from '@/store/profileStore';
import { radius, spacing, withShadow } from '@/constants/styles';
import { colors } from '@/styles/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type Tab = 'discover' | 'requests' | 'relationships' | 'rooms';

const TABS: { id: Tab; label: string; icon: IoniconName }[] = [
  { id: 'discover', label: 'Discover', icon: 'search-outline' },
  { id: 'requests', label: 'Requests', icon: 'mail-outline' },
  { id: 'relationships', label: 'Matches', icon: 'people-circle-outline' },
  { id: 'rooms', label: 'Rooms', icon: 'bed-outline' },
];

const TabBar: React.FC<{
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}> = ({ activeTab, onChange }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.tabBarContent}
  >
    {TABS.map((tab) => {
      const isActive = tab.id === activeTab;
      return (
        <Pressable
          key={tab.id}
          onPress={() => onChange(tab.id)}
          style={({ pressed }) => [
            styles.tab,
            isActive && styles.tabActive,
            pressed && styles.tabPressed,
          ]}
          accessibilityRole="tab"
          accessibilityState={{ selected: isActive }}
        >
          <Ionicons
            name={tab.icon}
            size={16}
            color={isActive ? '#ffffff' : colors.COLOR_BLACK_LIGHT_2}
          />
          <BloomText
            style={[styles.tabLabel, isActive && styles.tabLabelActive]}
          >
            {tab.label}
          </BloomText>
        </Pressable>
      );
    })}
  </ScrollView>
);

export default function RoommatesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { oxyServices, activeSessionId } = useOxy();
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('discover');
  const [isToggling, setIsToggling] = useState(false);

  const {
    profiles,
    requests,
    relationships,
    isLoading,
    fetchProfiles,
    fetchRequests,
    fetchRelationships,
    sendRequest,
    acceptRequest,
    declineRequest,
    endRelationship,
  } = useRoommate();

  const { primaryProfile, isPersonalProfile, hasPersonalProfile } = useProfile();

  const statusQuery = useQuery({
    queryKey: ['roommates', 'status'],
    queryFn: async () =>
      roommateService.getMyRoommateStatus(oxyServices, activeSessionId ?? undefined),
    enabled: Boolean(oxyServices && activeSessionId),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });

  const computedEnabledFromProfile = Boolean(
    isPersonalProfile &&
      hasPersonalProfile &&
      primaryProfile?.personalProfile?.settings?.roommate?.enabled,
  );

  const hasRoommateMatching = Boolean(
    statusQuery.data?.hasRoommateMatching ?? computedEnabledFromProfile,
  );

  // Tab-driven fetch (kept as effect since data is owned by the legacy hook)
  useEffect(() => {
    if (!isPersonalProfile || !hasPersonalProfile) return;
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
  }, [activeTab, isPersonalProfile, hasPersonalProfile]);

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
    if (!isPersonalProfile || !hasPersonalProfile) return;
    useProfileStore.getState().fetchPrimaryProfile();
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
      await useProfileStore.getState().fetchPrimaryProfile();
      queryClient.setQueryData(['roommates', 'status'], {
        hasRoommateMatching: result.enabled,
      });
      if (result.enabled) {
        fetchProfiles();
      }
      Alert.alert(
        'Success',
        result.message ||
          `Roommate matching ${result.enabled ? 'enabled' : 'disabled'}`,
      );
    } catch {
      Alert.alert('Error', 'Failed to toggle roommate matching');
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

  useEffect(() => {
    if (preferencesQuery.data?.preferences) {
      const prefs = preferencesQuery.data.preferences;
      setRoomFilters((prev: PropertyFilters) => ({
        ...prev,
        minPrice: prefs.budget?.min,
        maxPrice: prefs.budget?.max,
      }));
    }
  }, [preferencesQuery.data]);

  const renderDiscoverTab = () => {
    if (!isPersonalProfile || !hasPersonalProfile) {
      return (
        <EmptyState
          icon="person-outline"
          title="Personal profile required"
          description="Roommate matching is only available for personal profiles. Switch to your personal profile to use this feature."
          actionText="Switch to personal profile"
          actionIcon="person-circle"
          onAction={() => router.push('/profile')}
        />
      );
    }

    if (isLoading) {
      return (
        <View style={styles.loadingWrap}>
          <Loading variant="spinner" />
        </View>
      );
    }

    if (!hasRoommateMatching && profiles.length === 0) {
      return (
        <EmptyState
          icon="people-outline"
          title="Enable roommate matching"
          description="Turn on roommate matching to discover potential roommates based on your preferences."
          actionText={isToggling ? 'Enabling…' : 'Enable matching'}
          actionIcon="checkmark-circle"
          onAction={handleToggleMatching}
        />
      );
    }

    if (profiles.length === 0) {
      return (
        <EmptyState
          icon="people-outline"
          title="No roommates found"
          description="We couldn't find anyone matching your preferences. Try adjusting your settings."
          actionText="Update preferences"
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
    if (!isPersonalProfile || !hasPersonalProfile) {
      return (
        <EmptyState
          icon="person-outline"
          title="Personal profile required"
          description="Roommate matching is only available for personal profiles. Switch to your personal profile to use this feature."
          actionText="Switch to personal profile"
          actionIcon="person-circle"
          onAction={() => router.push('/profile')}
        />
      );
    }

    if (isLoading) {
      return (
        <View style={styles.loadingWrap}>
          <Loading variant="spinner" />
        </View>
      );
    }

    if (requests.sent.length === 0 && requests.received.length === 0) {
      return (
        <EmptyState
          icon="mail-outline"
          title="No requests yet"
          description="When you send or receive roommate requests, they'll appear here."
          actionText="Discover roommates"
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
    if (!isPersonalProfile || !hasPersonalProfile) {
      return (
        <EmptyState
          icon="person-outline"
          title="Personal profile required"
          description="Roommate matching is only available for personal profiles. Switch to your personal profile to use this feature."
          actionText="Switch to personal profile"
          actionIcon="person-circle"
          onAction={() => router.push('/profile')}
        />
      );
    }

    if (isLoading) {
      return (
        <View style={styles.loadingWrap}>
          <Loading variant="spinner" />
        </View>
      );
    }

    if (relationships.length === 0) {
      return (
        <EmptyState
          icon="people-circle-outline"
          title="No active relationships"
          description="When you accept roommate requests, your relationships will appear here."
          actionText="Discover roommates"
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
    if (!isPersonalProfile || !hasPersonalProfile) {
      return (
        <EmptyState
          icon="person-outline"
          title="Personal profile required"
          description="Room search is only available for personal profiles. Switch to your personal profile to use this feature."
          actionText="Switch to personal profile"
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
            <SectionEyebrow>Together</SectionEyebrow>
            <H1 style={styles.title}>Roommates</H1>
          </View>
          <Button
            variant="secondary"
            size="small"
            onPress={() => router.push('/roommates/preferences')}
            icon={
              <Ionicons
                name="settings-outline"
                size={16}
                color={colors.COLOR_BLACK}
              />
            }
          >
            Preferences
          </Button>
        </View>
        <TabBar activeTab={activeTab} onChange={setActiveTab} />
      </SafeAreaView>

      <View style={styles.content}>{renderTabContent()}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  headerWrap: {
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
    ...withShadow('sm'),
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  titleBlock: {
    gap: spacing.xs,
  },
  title: {
    letterSpacing: -0.5,
  },
  tabBarContent: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.mutedSubtle,
  },
  tabActive: {
    backgroundColor: colors.COLOR_BLACK,
  },
  tabPressed: {
    opacity: 0.85,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  tabLabelActive: {
    color: '#ffffff',
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
