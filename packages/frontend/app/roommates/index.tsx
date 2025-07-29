import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    RefreshControl,
    Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { useProfile } from '@/context/ProfileContext';
import LoadingSpinner from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { RoommateMatch } from '@/components/RoommateMatch';
import { RoommateRequestComponent } from '@/components/RoommateRequest';
import { RoommateRelationshipComponent } from '@/components/RoommateRelationship';
import { useRoommate } from '@/hooks/useRoommate';
import { useOxy } from '@oxyhq/services';
import { roommateService } from '@/services/roommateService';
import { useProfileStore } from '@/store/profileStore';

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

export default function RoommatesPage() {
    const router = useRouter();
    const [refreshing, setRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState<'discover' | 'requests' | 'relationships'>('discover');
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

    const { oxyServices, activeSessionId } = useOxy();

    const { primaryProfile } = useProfile();
    const isPersonalProfile = primaryProfile?.profileType === 'personal';
    const hasRoommateMatching = isPersonalProfile && (primaryProfile?.personalProfile?.settings?.roommate?.enabled || false);

    useEffect(() => {
        if (!hasRoommateMatching || !isPersonalProfile) return;

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
        }
    }, [activeTab, hasRoommateMatching, isPersonalProfile, fetchProfiles, fetchRequests, fetchRelationships]);

    const onRefresh = async () => {
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
            }
        } finally {
            setRefreshing(false);
        }
    };

    const handleToggleMatching = async () => {
        if (!oxyServices || !activeSessionId) return;
        try {
            // Toggle the current state
            const newState = !hasRoommateMatching;
            await roommateService.toggleRoommateMatching(newState, oxyServices, activeSessionId);
            await useProfileStore.getState().fetchPrimaryProfile(oxyServices, activeSessionId);
            if (newState) {
                await fetchProfiles();
            }
            Alert.alert('Success', `Roommate matching ${newState ? 'enabled' : 'disabled'}`);
        } catch (error) {
            Alert.alert('Error', 'Failed to toggle roommate matching');
        }
    };

    const handleViewProfile = (profileId: string) => {
        router.push(`/roommates/${profileId}`);
    };


    const renderDiscoverTab = () => {
        if (!isPersonalProfile) {
            return (
                <EmptyState
                    icon="person-outline"
                    title="Personal Profile Required"
                    description="Roommate matching is only available for personal profiles. Please switch to your personal profile to use this feature."
                    actionText="Switch to Personal Profile"
                    actionIcon="person-circle"
                    onAction={() => router.push('/profile')}
                />
            );
        }

        if (!hasRoommateMatching) {
            return (
                <EmptyState
                    icon="people-outline"
                    title="Enable Roommate Matching"
                    description="Turn on roommate matching to discover potential roommates based on your preferences."
                    actionText="Enable Matching"
                    actionIcon="checkmark-circle"
                    onAction={handleToggleMatching}
                />
            );
        }

        if (isLoading) {
            return <LoadingSpinner />;
        }

        if (profiles.length === 0) {
            return (
                <EmptyState
                    icon="people-outline"
                    title="No Roommates Found"
                    description="We couldn't find any potential roommates matching your preferences. Try adjusting your settings."
                    actionText="Update Preferences"
                    actionIcon="settings"
                    onAction={() => router.push('/roommates/preferences')}
                />
            );
        }

        return (
            <ScrollView
                style={styles.profilesList}
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
        if (!isPersonalProfile) {
            return (
                <EmptyState
                    icon="person-outline"
                    title="Personal Profile Required"
                    description="Roommate matching is only available for personal profiles. Please switch to your personal profile to use this feature."
                    actionText="Switch to Personal Profile"
                    actionIcon="person-circle"
                    onAction={() => router.push('/profile')}
                />
            );
        }

        if (isLoading) {
            return <LoadingSpinner />;
        }

        if (requests.sent.length === 0 && requests.received.length === 0) {
            return (
                <EmptyState
                    icon="mail-outline"
                    title="No Requests Yet"
                    description="When you send or receive roommate requests, they'll appear here."
                    actionText="Discover Roommates"
                    actionIcon="search"
                    onAction={() => setActiveTab('discover')}
                />
            );
        }

        return (
            <ScrollView
                style={styles.profilesList}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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
        if (isLoading) {
            return <LoadingSpinner />;
        }

        if (relationships.length === 0) {
            return (
                <EmptyState
                    icon="people-circle-outline"
                    title="No Active Relationships"
                    description="When you accept roommate requests, your relationships will appear here."
                    actionText="Discover Roommates"
                    actionIcon="search"
                    onAction={() => setActiveTab('discover')}
                />
            );
        }

        return (
            <ScrollView
                style={styles.profilesList}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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

    const renderTabContent = () => {
        switch (activeTab) {
            case 'discover':
                return renderDiscoverTab();
            case 'requests':
                return renderRequestsTab();
            case 'relationships':
                return renderRelationshipsTab();
            default:
                return renderDiscoverTab();
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Roommates</Text>
                <TouchableOpacity
                    style={styles.settingsButton}
                    onPress={() => router.push('/roommates/preferences')}
                >
                    <IconComponent name="settings-outline" size={24} color={colors.primaryDark} />
                </TouchableOpacity>
            </View>

            <View style={styles.tabBar}>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'discover' && styles.activeTab]}
                    onPress={() => setActiveTab('discover')}
                >
                    <IconComponent
                        name="search-outline"
                        size={20}
                        color={activeTab === 'discover' ? colors.primaryColor : colors.primaryDark_1}
                    />
                    <Text style={[styles.tabText, activeTab === 'discover' && styles.activeTabText]}>
                        Discover
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.tab, activeTab === 'requests' && styles.activeTab]}
                    onPress={() => setActiveTab('requests')}
                >
                    <IconComponent
                        name="mail-outline"
                        size={20}
                        color={activeTab === 'requests' ? colors.primaryColor : colors.primaryDark_1}
                    />
                    <Text style={[styles.tabText, activeTab === 'requests' && styles.activeTabText]}>
                        Requests
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.tab, activeTab === 'relationships' && styles.activeTab]}
                    onPress={() => setActiveTab('relationships')}
                >
                    <IconComponent
                        name="people-circle-outline"
                        size={20}
                        color={activeTab === 'relationships' ? colors.primaryColor : colors.primaryDark_1}
                    />
                    <Text style={[styles.tabText, activeTab === 'relationships' && styles.activeTabText]}>
                        Relationships
                    </Text>
                </TouchableOpacity>
            </View>

            <View style={styles.content}>
                {renderTabContent()}
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.primaryLight,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    title: {
        fontSize: 24,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    settingsButton: {
        padding: 8,
    },
    tabBar: {
        flexDirection: 'row',
        backgroundColor: colors.primaryLight,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    tab: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 8,
    },
    activeTab: {
        borderBottomWidth: 2,
        borderBottomColor: colors.primaryColor,
    },
    tabText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.primaryDark_1,
        marginLeft: 6,
    },
    activeTabText: {
        color: colors.primaryColor,
    },
    content: {
        flex: 1,
        paddingHorizontal: 16,
        paddingTop: 16,
    },
    profilesList: {
        flex: 1,
    },
    comingSoonText: {
        fontSize: 16,
        color: colors.primaryDark_1,
        textAlign: 'center',
        marginTop: 40,
        paddingHorizontal: 20,
    },
}); 