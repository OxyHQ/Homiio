import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { Header } from '@/components/Header';
import { PropertyList } from '@/components/PropertyList';
import { useProperties } from '@/hooks';
import { SearchBar } from '@/components/SearchBar';
import Button from '@/components/Button';
import { Property } from '@homiio/shared-types';
import { Ionicons } from '@expo/vector-icons';
import { useSavedProperties } from '@/hooks/useSavedProperties';
import { useOxy } from '@oxyhq/services';
import { useFavorites } from '@/hooks/useFavorites';
import { ThemedText } from '@/components/ThemedText';
import { PropertyListSkeleton } from '@/components/ui/skeletons/PropertyListSkeleton';

const screenWidth = Dimensions.get('window').width;
const isMobile = screenWidth < 600;
const IconComponent = Ionicons as any;

export default function PropertiesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { oxyServices, activeSessionId } = useOxy();
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(isMobile ? 'grid' : 'list');
  const [fadeAnim] = useState(new Animated.Value(1));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [total, setTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);

  const { properties: allProperties, loading, loadProperties } = useProperties();
  const { savedProperties } = useSavedProperties();
  const { isFavorite, toggleFavorite } = useFavorites();

  // Combine properties with favorite status
  const propertiesWithFavorite = allProperties.map((property) => ({
    ...property,
    isFavorite: isFavorite(property._id || property.id || ''),
  }));

  useEffect(() => {
    loadProperties();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadProperties();
    setRefreshing(false);
  };

  const handlePropertyPress = (property: Property) => {
    router.push(`/properties/${property._id || property.id}`);
  };

  const toggleViewMode = () => {
    setViewMode((prev) => (prev === 'list' ? 'grid' : 'list'));
    Animated.sequence([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const renderFilterButton = () => (
    <TouchableOpacity
      style={styles.filterButton}
      onPress={() => router.push('/properties/filters')}
    >
      <IconComponent name="filter" size={20} color={colors.COLOR_BLACK} />
    </TouchableOpacity>
  );

  const renderRecentlyViewedButton = () => (
    <TouchableOpacity
      style={styles.recentlyViewedButton}
      onPress={() => router.push('/properties/recently-viewed')}
    >
      <IconComponent name="time" size={20} color={colors.COLOR_BLACK} />
    </TouchableOpacity>
  );

  const renderViewModeToggle = () => (
    <TouchableOpacity style={styles.viewModeToggle} onPress={toggleViewMode}>
      <IconComponent
        name={viewMode === 'grid' ? 'list' : 'grid'}
        size={20}
        color={colors.COLOR_BLACK}
      />
    </TouchableOpacity>
  );

  const renderFAB = () => (
    <TouchableOpacity style={styles.fab} onPress={() => router.push('/properties/create')}>
      <IconComponent name="add" size={24} color="white" />
    </TouchableOpacity>
  );

  const renderErrorState = () => (
    <View style={styles.errorState}>
      <IconComponent name="alert-circle" size={48} color={colors.COLOR_BLACK_LIGHT_4} />
      <ThemedText style={styles.errorTitle}>{error}</ThemedText>
      <Button onPress={() => loadProperties()}>Try Again</Button>
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <IconComponent name="home-outline" size={48} color={colors.COLOR_BLACK_LIGHT_4} />
      <ThemedText style={styles.emptyTitle}>No properties found</ThemedText>
      <ThemedText style={styles.emptyDescription}>Try adjusting your search criteria</ThemedText>
    </View>
  );

  return (
    <View style={styles.container}>
      <View
        style={styles.stickyHeaderWrapper}
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
      >
        <Header options={{ title: t('Properties'), titlePosition: 'left' }} />
      </View>
      {!loading && allProperties.length > 0 && (
        <View style={[styles.topBar, { paddingTop: headerHeight }]}>
          {' '}
          {/* Move topBar below header */}
          <View style={styles.searchBarContainer}>
            <SearchBar hideFilterIcon={true} />
          </View>
          {renderFilterButton()}
          {renderRecentlyViewedButton()}
          {renderViewModeToggle()}
        </View>
      )}
      {!loading && allProperties.length > 0 && (
        <View style={styles.resultCountBar}>
          <ThemedText style={styles.resultCountText}>
            {t('Results')}: {allProperties.length}
          </ThemedText>
        </View>
      )}
      {loading && !allProperties.length ? (
        <PropertyListSkeleton viewMode={viewMode} />
      ) : error ? (
        renderErrorState()
      ) : allProperties.length === 0 ? (
        renderEmptyState()
      ) : (
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <PropertyList
            key={viewMode}
            properties={propertiesWithFavorite}
            onPropertyPress={handlePropertyPress}
          />
        </Animated.View>
      )}
      {renderFAB()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primaryLight,
  },
  stickyHeaderWrapper: {
    zIndex: 100,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.primaryLight,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 8,
    backgroundColor: colors.primaryLight,
  },
  searchBarContainer: {
    flex: 1,
  },
  filterButton: {
    marginLeft: 8,
    backgroundColor: colors.primaryLight_1,
    borderRadius: 100,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.primaryColor,
  },
  recentlyViewedButton: {
    marginLeft: 8,
    backgroundColor: colors.primaryLight_1,
    borderRadius: 100,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.primaryColor,
  },
  viewModeToggle: {
    flexDirection: 'row',
    marginLeft: 8,
    backgroundColor: colors.primaryLight_1,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: colors.primaryColor,
    overflow: 'hidden',
  },
  toggleButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  toggleButtonActive: {
    backgroundColor: colors.primaryColor,
  },
  resultCountBar: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 2,
    backgroundColor: colors.primaryLight,
  },
  resultCountText: {
    fontSize: 15,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 32,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.primaryDark,
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginBottom: 16,
    textAlign: 'center',
  },
  createButton: {
    marginTop: 12,
    alignSelf: 'center',
  },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ff4757',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorDescription: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginBottom: 16,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 12,
    alignSelf: 'center',
  },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 32,
    backgroundColor: colors.primaryColor,
    borderRadius: 32,
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 6,
    zIndex: 100,
  },
});
