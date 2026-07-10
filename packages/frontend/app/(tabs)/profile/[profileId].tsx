import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Text,
  RefreshControl,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Header } from '@/components/Header';
import { SaveButton } from '@/components/SaveButton';
import { useSavedProfiles } from '@/store/savedProfilesStore';
import { PropertyCard } from '@/components/PropertyCard';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import ProfileAvatar from '@/components/ProfileAvatar';
import { ProfileExchangeReviews } from '@/components/exchange/ProfileExchangeReviews';
import { colors } from '@/styles/colors';
import { shadowToken } from '@/styles/shadows';
import { spacing } from '@/constants/styles';
import { useOxy } from '@oxyhq/services';
import { api } from '@/utils/api';
import { type Profile, ProfileType } from '@/services/profileService';
import { Ionicons } from '@expo/vector-icons';
import { PropertyType, type Property } from '@homiio/shared-types';
import { logger } from '@/utils/logger';

export default function PublicProfileScreen() {
  const { t } = useTranslation();
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  useOxy();
  const { isProfileSaved } = useSavedProfiles();

  const [properties, setProperties] = useState<Property[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'listings' | 'about'>('listings');
  const [listingsTotal, setListingsTotal] = useState<number>(0);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [activeType, setActiveType] = useState<'all' | PropertyType>('all');
  const [sortKey, setSortKey] = useState<'newest' | 'price_low' | 'price_high'>('newest');
  const [page, setPage] = useState<number>(1);
  const [hasNext, setHasNext] = useState<boolean>(true);

  const loadProfileProperties = useCallback(
    async (opts?: { reset?: boolean }) => {
      if (!profileId) return;
      try {
        setIsLoading(true);
        setError(null);
        const currentPage = opts?.reset ? 1 : page;
        // Map sort
        let sortBy = 'createdAt';
        let sortOrder: 'asc' | 'desc' = 'desc';
        if (sortKey === 'price_low') {
          sortBy = 'rent.amount';
          sortOrder = 'asc';
        }
        if (sortKey === 'price_high') {
          sortBy = 'rent.amount';
          sortOrder = 'desc';
        }
        const res = await api.get(`/api/properties`, {
          params: {
            profileId,
            limit: 20,
            page: currentPage,
            sortBy,
            sortOrder,
            type: activeType === 'all' ? undefined : activeType,
          },
        });
        const list: Property[] = res.data?.data || res.data?.properties || [];
        const pagination = res.data?.pagination;
        const total = pagination?.total ?? list.length;
        setProperties(opts?.reset ? list : [...properties, ...list]);
        setListingsTotal(total);
        setHasNext(Boolean(pagination?.hasNext));
        setPage(currentPage + 1);
      } catch (e: unknown) {
        logger.error('Failed to load profile properties:', e);
        const message = e instanceof Error ? e.message : 'Failed to load profile';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [profileId, page, sortKey, activeType, properties],
  );

  const loadProfileInfo = useCallback(async () => {
    if (!profileId) return;
    try {
      // Public, no-auth variant
      const res = await api.get(`/api/public/profiles/${profileId}`);
      setProfile(res.data?.data || res.data);
    } catch (e: unknown) {
      // Non-blocking; still show properties
      logger.warn('Failed to load profile info', e);
    }
  }, [profileId]);

  const handlePropertyPress = useCallback(
    (property: Property) => {
      router.push(`/properties/${(property._id || property.id) as string}`);
    },
    [],
  );

  // Shared end-reached guard used by both the list FlatList and the grid
  // ScrollView so infinite scroll behaves identically in either view mode.
  const handleEndReached = useCallback(() => {
    if (!isLoading && hasNext) loadProfileProperties();
  }, [isLoading, hasNext, loadProfileProperties]);

  useEffect(() => {
    // Wrapped in an inline async function so the loaders' internal setState
    // calls are not invoked synchronously within the effect body (which would
    // cause cascading renders). Reloads when the active type / sort changes.
    void (async () => {
      await Promise.all([loadProfileProperties({ reset: true }), loadProfileInfo()]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType, sortKey]);

  return (
    <View style={styles.container}>
      <Header
        options={{
          title: t('profile.title'),
          showBackButton: true,
          rightComponents: [
            profileId ? (
              <SaveButton
                key="follow"
                isSaved={isProfileSaved(String(profileId))}
                variant="heart"
                color={colors.COLOR_BLACK_LIGHT_2}
                activeColor={colors.error}
                profileId={String(profileId)}
              />
            ) : null,
          ],
        }}
      />
      {/* Cover + Profile header */}
      {profile && (
        <View>
          <View style={styles.cover} />
          <View style={styles.profileHeaderCard}>
            <ProfileAvatar
              profile={profile}
              size={56}
              style={styles.avatarLarge}
            />
            <View style={styles.profileHeaderInfo}>
              <Text style={styles.profileNameLarge} numberOfLines={1}>
                {profile.profileType === ProfileType.PERSONAL
                  ? profile.personalProfile?.personalInfo?.bio || profile.oxyUserId
                  : profile.agencyProfile?.legalCompanyName ||
                  profile.businessProfile?.legalCompanyName ||
                  profile.cooperativeProfile?.legalName ||
                  profile.oxyUserId}
              </Text>
              <Text style={styles.handleText}>@{String(profile._id).slice(-6)}</Text>
              {listingsTotal > 0 ? (
                <Text style={styles.profileMeta}>
                  {listingsTotal} {t('profile.listings')}
                </Text>
              ) : null}
            </View>
          </View>
          {/* Filters and view controls */}
          <View style={styles.controlsRow}>
            <View style={styles.typeChipsRow}>
              {(
                [
                  'all',
                  PropertyType.APARTMENT,
                  PropertyType.HOUSE,
                  PropertyType.STUDIO,
                  PropertyType.ROOM,
                ] as const
              ).map((tab) => {
                const label =
                  tab === 'all'
                    ? t('common.all')
                    : tab === PropertyType.APARTMENT
                      ? t('properties.titles.types.apartment')
                      : tab === PropertyType.HOUSE
                        ? t('properties.titles.types.house')
                        : tab === PropertyType.STUDIO
                          ? t('properties.titles.types.studio')
                          : t('properties.titles.types.room');
                return (
                  <TouchableOpacity
                    key={String(tab)}
                    onPress={() => {
                      setActiveType(tab);
                    }}
                    style={[styles.chip, activeType === tab && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, activeType === tab && styles.chipTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.rightControls}>
              <View style={styles.segmented}>
                <TouchableOpacity onPress={() => setViewMode('list')} style={styles.segment}>
                  <Ionicons
                    name="list"
                    size={16}
                    color={viewMode === 'list' ? colors.COLOR_BLACK : colors.COLOR_BLACK_LIGHT_4}
                  />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setViewMode('grid')} style={styles.segment}>
                  <Ionicons
                    name="grid"
                    size={16}
                    color={viewMode === 'grid' ? colors.COLOR_BLACK : colors.COLOR_BLACK_LIGHT_4}
                  />
                </TouchableOpacity>
              </View>
              <View style={styles.segmented}>
                <TouchableOpacity onPress={() => setSortKey('newest')} style={styles.segment}>
                  <Ionicons
                    name="time-outline"
                    size={16}
                    color={sortKey === 'newest' ? colors.COLOR_BLACK : colors.COLOR_BLACK_LIGHT_4}
                  />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setSortKey('price_low')} style={styles.segment}>
                  <Ionicons
                    name="arrow-down"
                    size={16}
                    color={
                      sortKey === 'price_low' ? colors.COLOR_BLACK : colors.COLOR_BLACK_LIGHT_4
                    }
                  />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setSortKey('price_high')} style={styles.segment}>
                  <Ionicons
                    name="arrow-up"
                    size={16}
                    color={
                      sortKey === 'price_high' ? colors.COLOR_BLACK : colors.COLOR_BLACK_LIGHT_4
                    }
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
          {/* Bio/description */}
          {(profile.personalProfile?.personalInfo?.occupation ||
            profile.agencyProfile?.description ||
            profile.businessProfile?.description ||
            profile.cooperativeProfile?.description) && (
              <View style={styles.bioCard}>
                <Text style={styles.sectionText}>
                  {profile.profileType === ProfileType.PERSONAL
                    ? profile.personalProfile?.personalInfo?.occupation || ''
                    : profile.agencyProfile?.description ||
                    profile.businessProfile?.description ||
                    profile.cooperativeProfile?.description ||
                    ''}
                </Text>
              </View>
            )}
          {/* Tabs */}
          <View style={styles.tabsRow}>
            <TouchableOpacity
              onPress={() => setActiveTab('listings')}
              style={[styles.tabItem, activeTab === 'listings' && styles.tabItemActive]}
            >
              <Text style={[styles.tabText, activeTab === 'listings' && styles.tabTextActive]}>
                {t('profile.tabs.listings')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab('about')}
              style={[styles.tabItem, activeTab === 'about' && styles.tabItemActive]}
            >
              <Text style={[styles.tabText, activeTab === 'about' && styles.tabTextActive]}>
                {t('profile.tabs.about')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {activeTab === 'listings' ? (
        viewMode === 'grid' ? (
          // Grid mode → the single app-wide responsive property grid. A
          // ScrollView hosts it (the grid is a plain View) and drives infinite
          // scroll + pull-to-refresh to match the list-mode FlatList.
          <ScrollView
            contentContainerStyle={styles.gridScrollContent}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={200}
            onScroll={({ nativeEvent }) => {
              const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
              const distanceFromEnd =
                contentSize.height - (layoutMeasurement.height + contentOffset.y);
              if (distanceFromEnd < layoutMeasurement.height) handleEndReached();
            }}
            refreshControl={
              <RefreshControl
                refreshing={isLoading}
                onRefresh={() => loadProfileProperties({ reset: true })}
                colors={[colors.primaryColor]}
                tintColor={colors.primaryColor}
              />
            }
          >
            <PropertyResultsGrid
              properties={properties}
              onPropertyPress={handlePropertyPress}
            />
          </ScrollView>
        ) : (
          <FlatList
            data={properties}
            keyExtractor={(item) => (item._id || item.id) as string}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.cardWrap}>
                <PropertyCard
                  property={item}
                  variant="saved"
                  orientation="horizontal"
                  onPress={() => router.push(`/properties/${(item._id || item.id) as string}`)}
                />
              </View>
            )}
            onEndReachedThreshold={0.5}
            onEndReached={handleEndReached}
            refreshControl={
              <RefreshControl
                refreshing={isLoading}
                onRefresh={() => loadProfileProperties({ reset: true })}
                colors={[colors.primaryColor]}
                tintColor={colors.primaryColor}
              />
            }
          />
        )
      ) : (
        <ScrollView contentContainerStyle={styles.aboutContainer}>
          {/* Home-exchange trust signal — avg rating + recent reviews. Self-hides
              when the profile has no exchange reviews. */}
          {profileId ? (
            <View style={styles.exchangeReviewsWrap}>
              <ProfileExchangeReviews profileId={String(profileId)} />
            </View>
          ) : null}
          {/* About details by type */}
          {profile && profile.profileType === ProfileType.PERSONAL && (
            <View style={styles.aboutCard}>
              <Text style={styles.aboutTitle}>{t('profile.about')}</Text>
              {profile.personalProfile?.personalInfo?.bio ? (
                <Text style={styles.aboutItem}>{profile.personalProfile.personalInfo.bio}</Text>
              ) : null}
              {profile.personalProfile?.personalInfo?.occupation ? (
                <Text style={styles.aboutItem}>
                  {t('profile.occupation')}:{' '}
                  {profile.personalProfile.personalInfo.occupation}
                </Text>
              ) : null}
              {profile.personalProfile?.personalInfo?.employer ? (
                <Text style={styles.aboutItem}>
                  {t('profile.employer')}:{' '}
                  {profile.personalProfile.personalInfo.employer}
                </Text>
              ) : null}
              {typeof profile.personalProfile?.preferences?.maxRent === 'number' ? (
                <Text style={styles.aboutItem}>
                  {t('profile.budget')}: ${profile.personalProfile.preferences.maxRent}
                </Text>
              ) : null}
              {profile.personalProfile?.preferences?.minBedrooms ||
                profile.personalProfile?.preferences?.minBathrooms ? (
                <Text style={styles.aboutItem}>
                  {t('profile.preferences')}:{' '}
                  {profile.personalProfile?.preferences?.minBedrooms ?? 0} bd •{' '}
                  {profile.personalProfile?.preferences?.minBathrooms ?? 0} ba
                </Text>
              ) : null}
              {profile.personalProfile?.trustScore?.score ? (
                <Text style={styles.aboutItem}>
                  {t('profile.trustScore')}:{' '}
                  {profile.personalProfile.trustScore.score}
                </Text>
              ) : null}
            </View>
          )}
          {profile &&
            (profile.profileType === ProfileType.AGENCY ||
              profile.profileType === ProfileType.BUSINESS ||
              profile.profileType === ProfileType.COOPERATIVE) && (
              <View style={styles.aboutCard}>
                <Text style={styles.aboutTitle}>{t('profile.about')}</Text>
                {profile.agencyProfile?.description ? (
                  <Text style={styles.aboutItem}>{profile.agencyProfile.description}</Text>
                ) : null}
                {profile.businessProfile?.description ? (
                  <Text style={styles.aboutItem}>{profile.businessProfile.description}</Text>
                ) : null}
                {/* Service areas / specialties if present */}
                {profile.agencyProfile?.businessDetails?.specialties?.length ? (
                  <Text style={styles.aboutItem}>
                    {t('profile.specialties')}:{' '}
                    {profile.agencyProfile.businessDetails.specialties.join(', ')}
                  </Text>
                ) : null}
                {profile.agencyProfile?.businessDetails?.serviceAreas?.length ? (
                  <Text style={styles.aboutItem}>
                    {t('profile.serviceAreas')}:{' '}
                    {profile.agencyProfile.businessDetails.serviceAreas
                      .map((s) => s.city)
                      .filter(Boolean)
                      .join(', ')}
                  </Text>
                ) : null}
                {profile.agencyProfile?.businessDetails?.yearEstablished ? (
                  <Text style={styles.aboutItem}>
                    {t('profile.established')}:{' '}
                    {profile.agencyProfile.businessDetails.yearEstablished}
                  </Text>
                ) : null}
              </View>
            )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    padding: 16,
    paddingBottom: 100,
  },
  // The grid owns its own column gaps; the surrounding scroll content just
  // contributes the page gutter + bottom breathing room (matches the other
  // property-grid screens' `spacing.lg`).
  gridScrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 100,
  },
  cover: {
    height: 96,
    backgroundColor: colors.mutedSubtle,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  profileHeaderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: -20,
    marginBottom: 8,
    padding: 12,
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadowToken({ y: 1, blur: 6, color: colors.COLOR_BLACK, opacity: 0.06, elevation: 2 }),
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
  },
  typeChipsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 100,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.surface,
    borderColor: colors.primaryColor,
  },
  chipText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.COLOR_BLACK,
  },
  rightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 100,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  segment: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 100,
  },
  avatarLarge: {
    marginRight: 12,
  },
  profileHeaderInfo: {
    flex: 1,
  },
  profileNameLarge: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  handleText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginBottom: 2,
  },
  bioCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  sectionText: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  tabsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: colors.white,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  tabItemActive: {
    backgroundColor: colors.surface,
  },
  tabText: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_4,
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.COLOR_BLACK,
  },
  aboutContainer: {
    padding: 16,
    paddingBottom: 80,
  },
  aboutCard: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 12,
  },
  exchangeReviewsWrap: {
    marginBottom: 12,
  },
  aboutTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
    color: colors.COLOR_BLACK,
  },
  aboutItem: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
    marginBottom: 4,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    padding: 12,
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadowToken({ y: 1, blur: 6, color: colors.COLOR_BLACK, opacity: 0.06, elevation: 2 }),
  },

  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    marginBottom: 2,
  },
  profileMeta: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  cardWrap: {
    marginBottom: 12,
  },
  error: {
    color: colors.COLOR_BLACK,
    padding: 16,
  },
});
