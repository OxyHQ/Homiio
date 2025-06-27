import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { PropertyCard } from '@/components/PropertyCard';
import { useEcoProperties } from '@/hooks/usePropertyListRedux';
import type { Property } from '@/services/propertyService';

// Type assertion for Ionicons compatibility with React 19
const IconComponent = Ionicons as any;

export default function EcoPropertiesPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // Use Redux hook instead of local state
  const { properties, loading, error, loadProperties } = useEcoProperties();

  const filterOptions = [
    { id: 'energy-a', label: t('Energy A'), icon: 'flash' },
    { id: 'solar', label: t('Solar'), icon: 'sunny' },
    { id: 'garden', label: t('Garden'), icon: 'leaf' },
    { id: 'coliving', label: t('Co-Living'), icon: 'people' },
  ];

  useEffect(() => {
    // Load eco properties on mount
    loadProperties();
  }, [loadProperties]);

  const getFilteredProperties = () => {
    if (!activeFilter) return properties;

    switch (activeFilter) {
      case 'energy-a':
        return properties.filter(p => p.energyStats?.current?.power && p.energyStats.current.power > 0);
      case 'solar':
        return properties.filter(p => p.amenities?.some((f: string) => f.toLowerCase().includes('solar')));
      case 'garden':
        return properties.filter(p => p.amenities?.some((f: string) => f.toLowerCase().includes('garden')));
      case 'coliving':
        return properties.filter(p => p.type === 'room' || p.housingType === 'public');
      default:
        return properties;
    }
  };

  const handleFilterPress = (filterId: string) => {
    setActiveFilter(activeFilter === filterId ? null : filterId);
  };

  const renderFilterOption = (option: { id: string; label: string; icon: string }) => (
    <TouchableOpacity
      key={option.id}
      style={[
        styles.filterOption,
        activeFilter === option.id && styles.activeFilterOption
      ]}
      onPress={() => handleFilterPress(option.id)}
    >
      <IconComponent
        name={option.icon}
        size={18}
        color={activeFilter === option.id ? 'white' : colors.COLOR_BLACK}
      />
      <Text
        style={[
          styles.filterText,
          activeFilter === option.id && styles.activeFilterText
        ]}
      >
        {option.label}
      </Text>
    </TouchableOpacity>
  );

  const renderPropertyItem = ({ item }: { item: Property }) => (
    <PropertyCard
      property={item}
      onPress={() => router.push(`/properties/${item._id || item.id}`)}
      style={styles.propertyCard}
    />
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Header
        options={{
          showBackButton: true,
          title: t("Eco-Certified Properties"),
          titlePosition: 'center',
        }}
      />

      <View style={styles.container}>
        {/* Hero Banner */}
        <View style={styles.ecoBanner}>
          <View style={styles.ecoBannerContent}>
            <Text style={styles.ecoBannerTitle}>{t("Sustainable Living")}</Text>
            <Text style={styles.ecoBannerText}>
              {t("All properties meet strict eco-friendly standards for energy efficiency, sustainable materials, and minimal environmental impact.")}
            </Text>
          </View>
          <View style={styles.ecoBannerIcon}>
            <IconComponent name="leaf" size={40} color="white" />
          </View>
        </View>

        {/* Filters */}
        <View style={styles.filtersContainer}>
          <Text style={styles.filtersTitle}>{t("Filter by:")}</Text>
          <View style={styles.filtersRow}>
            {filterOptions.map(renderFilterOption)}
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="green" />
            <Text style={styles.loadingText}>{t("Loading eco properties...")}</Text>
          </View>
        ) : (
          <FlatList
            data={getFilteredProperties()}
            renderItem={renderPropertyItem}
            keyExtractor={(item) => (item._id || item.id || '').toString()}
            contentContainerStyle={styles.listContainer}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <IconComponent name="leaf" size={60} color={colors.COLOR_BLACK_LIGHT_3} />
                <Text style={styles.emptyText}>
                  {t("No eco properties match your filters")}
                </Text>
                <TouchableOpacity
                  style={styles.resetButton}
                  onPress={() => setActiveFilter(null)}
                >
                  <Text style={styles.resetButtonText}>{t("Reset Filters")}</Text>
                </TouchableOpacity>
              </View>
            }
          />
        )}

        {/* Info Panel */}
        <View style={styles.infoPanel}>
          <View style={styles.infoItem}>
            <View style={styles.infoIcon}>
              <Text style={styles.energyLabel}>A+</Text>
            </View>
            <Text style={styles.infoText}>{t("Top energy efficiency rating")}</Text>
          </View>

          <View style={styles.infoItem}>
            <View style={styles.infoIcon}>
              <IconComponent name="water-outline" size={22} color="green" />
            </View>
            <Text style={styles.infoText}>{t("Water conservation features")}</Text>
          </View>

          <View style={styles.infoItem}>
            <View style={styles.infoIcon}>
              <IconComponent name="leaf-outline" size={22} color="green" />
            </View>
            <Text style={styles.infoText}>{t("Sustainably sourced materials")}</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.COLOR_BACKGROUND,
  },
  container: {
    flex: 1,
    padding: 15,
  },
  ecoBanner: {
    backgroundColor: 'green',
    borderRadius: 15,
    padding: 20,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  ecoBannerContent: {
    flex: 1,
  },
  ecoBannerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 8,
  },
  ecoBannerText: {
    fontSize: 14,
    color: 'white',
    opacity: 0.9,
    lineHeight: 20,
  },
  ecoBannerIcon: {
    marginLeft: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filtersContainer: {
    marginBottom: 15,
  },
  filtersTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
    color: colors.COLOR_BLACK,
  },
  filtersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#e7f4e4',
    borderRadius: 20,
  },
  activeFilterOption: {
    backgroundColor: 'green',
  },
  filterText: {
    marginLeft: 6,
    fontWeight: '500',
    color: colors.COLOR_BLACK,
  },
  activeFilterText: {
    color: 'white',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  listContainer: {
    paddingBottom: 20,
  },
  propertyCard: {
    backgroundColor: 'white',
    borderRadius: 15,
    marginBottom: 15,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  propertyImagePlaceholder: {
    height: 150,
    backgroundColor: '#e7f4e4',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  energyRatingBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'green',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  energyRatingText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
  propertyContent: {
    padding: 15,
  },
  propertyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  propertyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    flex: 1,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    marginLeft: 4,
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  propertyLocation: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 10,
  },
  propertyFeatures: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  featureBadge: {
    backgroundColor: '#e7f4e4',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    marginRight: 8,
    marginBottom: 5,
  },
  featureText: {
    fontSize: 12,
    color: 'green',
  },
  moreFeatures: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  propertyPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  resetButton: {
    backgroundColor: 'green',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
  },
  resetButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  infoPanel: {
    backgroundColor: '#f9f9f9',
    borderRadius: 15,
    padding: 15,
    marginTop: 10,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e7f4e4',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  energyLabel: {
    fontWeight: 'bold',
    color: 'green',
    fontSize: 14,
  },
  infoText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
});