import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ImageBackground, TextInput, TouchableOpacity, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');

  const featuredCities = [
    { id: '1', name: 'Barcelona', count: 128 },
    { id: '2', name: 'Berlin', count: 94 },
    { id: '3', name: 'Stockholm', count: 75 },
    { id: '4', name: 'Amsterdam', count: 103 },
  ];

  const propertyTypes = [
    { id: '1', name: 'Apartments', icon: 'business-outline' },
    { id: '2', name: 'Houses', icon: 'home-outline' },
    { id: '3', name: 'Co-living', icon: 'people-outline' },
    { id: '4', name: 'Eco-friendly', icon: 'leaf-outline' },
  ];

  const handleSearch = () => {
    if (searchQuery.trim()) {
      router.push(`/properties/search/${encodeURIComponent(searchQuery)}`);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <ScrollView style={styles.container}>
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <View style={styles.heroContent}>
            <Text style={styles.heroTitle}>{t("Find your ethical home")}</Text>
            <Text style={styles.heroSubtitle}>
              {t("Transparent rentals with fair agreements and verified properties")}
            </Text>

            <View style={styles.searchContainer}>
              <View style={styles.searchBar}>
                <Ionicons name="search" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
                <TextInput
                  style={styles.searchInput}
                  placeholder={t("Where do you want to live?")}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  onSubmitEditing={handleSearch}
                />
              </View>
              <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
                <Text style={styles.searchButtonText}>{t("Search")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Trust Features */}
        <View style={styles.trustSection}>
          <Text style={styles.sectionTitle}>{t("Housing You Can Trust")}</Text>
          <View style={styles.trustFeatures}>
            <View style={styles.trustFeature}>
              <View style={styles.featureIconCircle}>
                <Ionicons name="shield-checkmark" size={24} color={colors.primaryColor} />
              </View>
              <Text style={styles.featureTitle}>{t("Verified Listings")}</Text>
              <Text style={styles.featureDescription}>
                {t("All properties verified for authenticity and condition")}
              </Text>
            </View>

            <View style={styles.trustFeature}>
              <View style={styles.featureIconCircle}>
                <Ionicons name="document-text" size={24} color={colors.primaryColor} />
              </View>
              <Text style={styles.featureTitle}>{t("Fair Agreements")}</Text>
              <Text style={styles.featureDescription}>
                {t("Transparent contracts with no hidden terms")}
              </Text>
            </View>

            <View style={styles.trustFeature}>
              <View style={styles.featureIconCircle}>
                <Ionicons name="star" size={24} color={colors.primaryColor} />
              </View>
              <Text style={styles.featureTitle}>{t("Trust Score")}</Text>
              <Text style={styles.featureDescription}>
                {t("Reputation system for both tenants and landlords")}
              </Text>
            </View>
          </View>
        </View>

        {/* Featured Cities */}
        <View style={styles.citiesSection}>
          <Text style={styles.sectionTitle}>{t("Featured Cities")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalScroll}>
            {featuredCities.map((city) => (
              <TouchableOpacity 
                key={city.id} 
                style={styles.cityCard}
                onPress={() => router.push(`/properties/city/${city.id}`)}
              >
                <View style={styles.cityImagePlaceholder}>
                  <Text style={styles.cityName}>{city.name}</Text>
                </View>
                <Text style={styles.cityCount}>{city.count} {t("properties")}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Property Types */}
        <View style={styles.typesSection}>
          <Text style={styles.sectionTitle}>{t("Browse by Category")}</Text>
          <View style={styles.categoryContainer}>
            {propertyTypes.map((type) => (
              <TouchableOpacity 
                key={type.id} 
                style={styles.categoryCard}
                onPress={() => router.push(`/properties/type/${type.id}`)}
              >
                <View style={styles.categoryIconWrap}>
                  <Ionicons name={type.icon as keyof typeof Ionicons.glyphMap} size={32} color={colors.primaryColor} />
                </View>
                <Text style={styles.categoryName}>{type.name}</Text>
                <View style={styles.categoryBadge}>
                  <Text style={styles.categoryBadgeText}>{t("View")}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Horizon Initiative */}
        <View style={styles.horizonSection}>
          <View style={styles.horizonContent}>
            <Text style={styles.horizonTitle}>{t("Join Horizon")}</Text>
            <Text style={styles.horizonDescription}>
              {t("Horizon is a global initiative offering fair housing, healthcare, and travel support. Now integrated with Homiio.")}
            </Text>
            <TouchableOpacity style={styles.horizonButton} onPress={() => router.push('/horizon')}>
              <Text style={styles.horizonButtonText}>{t("Learn More")}</Text>
              <Ionicons name="arrow-forward" size={16} color="#333" style={{ marginLeft: 5 }} />
            </TouchableOpacity>
          </View>
          <View style={styles.horizonImagePlaceholder}>
            <Ionicons name="globe-outline" size={50} color="#FFD700" />
          </View>
        </View>

        {/* Eco Certification */}
        <View style={styles.ecoSection}>
          <View style={styles.ecoIcon}>
            <Ionicons name="leaf" size={40} color="green" />
          </View>
          <View style={styles.ecoContent}>
            <Text style={styles.ecoTitle}>{t("Eco-Certified Properties")}</Text>
            <Text style={styles.ecoDescription}>
              {t("Find sustainable properties that meet our energy efficiency and eco-friendly standards")}
            </Text>
            <TouchableOpacity style={styles.ecoButton} onPress={() => router.push('/properties/eco')}>
              <Text style={styles.ecoButtonText}>{t("View Eco Properties")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heroSection: {
    height: 300,
    backgroundColor: colors.primaryColor,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    borderRadius: 35,
  },
  heroContent: {
    width: '100%',
    maxWidth: 800,
    alignItems: 'center',
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 10,
  },
  heroSubtitle: {
    fontSize: 16,
    color: 'white',
    opacity: 0.9,
    textAlign: 'center',
    marginBottom: 30,
    maxWidth: 400,
  },
  searchContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 30,
    paddingHorizontal: 15,
    height: 50,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
  },
  searchButton: {
    backgroundColor: colors.COLOR_BLACK,
    borderRadius: 30,
    padding: 15,
    height: 50,
    justifyContent: 'center',
  },
  searchButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
    color: colors.COLOR_BLACK,
  },
  trustSection: {
    padding: 20,
    marginTop: 20,
  },
  trustFeatures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  trustFeature: {
    width: '30%',
    alignItems: 'center',
    marginBottom: 20,
  },
  featureIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  featureTitle: {
    fontWeight: 'bold',
    marginBottom: 5,
    textAlign: 'center',
  },
  featureDescription: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  citiesSection: {
    padding: 20,
  },
  horizontalScroll: {
    flexDirection: 'row',
  },
  cityCard: {
    width: 150,
    marginRight: 15,
  },
  cityImagePlaceholder: {
    width: '100%',
    height: 100,
    backgroundColor: '#e0e0e0',
    borderRadius: 10,
    marginBottom: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cityName: {
    fontWeight: 'bold',
    fontSize: 16,
  },
  cityCount: {
    color: colors.COLOR_BLACK_LIGHT_3,
    fontSize: 12,
  },
  typesSection: {
    padding: 20,
  },
  categoryContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryCard: {
    width: '49%',
    backgroundColor: colors.primaryLight,
    padding: 10,
    borderRadius: 35,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primaryColor,
  },
  categoryIconWrap: {
    backgroundColor: colors.primaryLight,
    borderRadius: 50,
    width: 70,
    height: 70,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  categoryName: {
    fontWeight: '600',
    fontSize: 16,
    marginBottom: 8,
    color: colors.COLOR_BLACK,
  },
  categoryBadge: {
    backgroundColor: colors.primaryColor,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 15,
    marginTop: 10,
  },
  categoryBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  horizonSection: {
    backgroundColor: colors.primaryLight,
    padding: 20,
    margin: 20,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
  },
  horizonContent: {
    flex: 1,
  },
  horizonTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  horizonDescription: {
    marginBottom: 15,
    lineHeight: 20,
  },
  horizonButton: {
    backgroundColor: '#FFD700',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 'auto',
  },
  horizonButtonText: {
    fontWeight: 'bold',
    color: '#333',
  },
  horizonImagePlaceholder: {
    marginLeft: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ecoSection: {
    flexDirection: 'row',
    backgroundColor: '#e7f4e4',
    padding: 20,
    margin: 20,
    marginTop: 0,
    borderRadius: 35,
    alignItems: 'center',
  },
  ecoIcon: {
    marginRight: 15,
  },
  ecoContent: {
    flex: 1,
  },
  ecoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#2e7d32',
  },
  ecoDescription: {
    marginBottom: 10,
    lineHeight: 20,
  },
  ecoButton: {
    backgroundColor: 'green',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  ecoButtonText: {
    color: 'white',
    fontWeight: '600',
  },
});