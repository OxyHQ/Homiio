import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '@/components/Header';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { LineChart } from 'react-native-chart-kit';

// Sample data for charts
const electricityData = {
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
  datasets: [
    {
      data: [120, 115, 110, 105, 95, 90],
      color: (opacity = 1) => `rgba(255, 193, 7, ${opacity})`,
      strokeWidth: 2,
    },
  ],
  legend: ['kWh'],
};

const waterData = {
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
  datasets: [
    {
      data: [4.2, 4.5, 4.1, 3.9, 3.7, 3.5],
      color: (opacity = 1) => `rgba(33, 150, 243, ${opacity})`,
      strokeWidth: 2,
    },
  ],
  legend: ['m³'],
};

const gasData = {
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
  datasets: [
    {
      data: [30, 32, 28, 25, 22, 20],
      color: (opacity = 1) => `rgba(76, 175, 80, ${opacity})`,
      strokeWidth: 2,
    },
  ],
  legend: ['m³'],
};

type UtilityType = 'electricity' | 'water' | 'gas';

interface EnergyTip {
  id: string;
  title: string;
  description: string;
  icon: string;
  savings: string;
}

export default function PropertyMonitoringScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams();
  const propertyId = params.id as string;
  const propertyName = (params.name as string) || 'Your Property';

  const [loading, setLoading] = useState(true);
  const [selectedUtility, setSelectedUtility] = useState<UtilityType>('electricity');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Energy saving tips
  const energyTips: EnergyTip[] = [
    {
      id: '1',
      title: 'Switch to LED Lighting',
      description:
        'Replace all bulbs with LED alternatives to reduce electricity consumption by up to 80%.',
      icon: 'bulb',
      savings: 'Save up to ⊜120/year',
    },
    {
      id: '2',
      title: 'Install Water-Saving Shower Heads',
      description:
        'Reduce water usage while maintaining pressure for a comfortable shower experience.',
      icon: 'water',
      savings: 'Save up to ⊜80/year',
    },
    {
      id: '3',
      title: 'Set Optimal Heating Temperature',
      description: 'Lowering your thermostat by just 1°C can reduce heating bills by up to 10%.',
      icon: 'thermometer',
      savings: 'Save up to ⊜90/year',
    },
    {
      id: '4',
      title: 'Use Smart Power Strips',
      description: 'Eliminate phantom energy use from devices on standby mode.',
      icon: 'flash',
      savings: 'Save up to ⊜60/year',
    },
  ];

  useEffect(() => {
    // Simulate loading data
    const timer = setTimeout(() => {
      setLoading(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  const getUtilityData = (type: UtilityType) => {
    switch (type) {
      case 'electricity':
        return {
          data: electricityData,
          currentUsage: 90,
          averageUsage: 110,
          change: -18.2,
          unit: 'kWh',
          icon: 'flash',
          color: '#FFC107',
          background: 'rgba(255, 193, 7, 0.1)',
          savings: '⊜25.30 this month',
        };
      case 'water':
        return {
          data: waterData,
          currentUsage: 3.5,
          averageUsage: 4.2,
          change: -16.7,
          unit: 'm³',
          icon: 'water',
          color: '#2196F3',
          background: 'rgba(33, 150, 243, 0.1)',
          savings: '⊜12.80 this month',
        };
      case 'gas':
        return {
          data: gasData,
          currentUsage: 20,
          averageUsage: 28,
          change: -28.6,
          unit: 'm³',
          icon: 'flame',
          color: '#4CAF50',
          background: 'rgba(76, 175, 80, 0.1)',
          savings: '⊜18.50 this month',
        };
    }
  };

  const utilityInfo = getUtilityData(selectedUtility);

  const handleRefresh = () => {
    setIsRefreshing(true);
    // Simulate refreshing data
    setTimeout(() => {
      setIsRefreshing(false);
    }, 1500);
  };

  const handleCompare = () => {
    router.push(`/properties/${propertyId}/compare?type=${selectedUtility}`);
  };

  const handleReportIssue = () => {
    router.push(`/support/report-issue?propertyId=${propertyId}&type=utility`);
  };

  const screenWidth = Dimensions.get('window').width;

  const chartConfig = {
    backgroundGradientFrom: '#fff',
    backgroundGradientTo: '#fff',
    color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
    strokeWidth: 2,
    decimalPlaces: 1,
    style: {
      borderRadius: 16,
    },
    propsForDots: {
      r: '5',
      strokeWidth: '2',
      stroke: utilityInfo.color,
    },
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header
          options={{
            title: t('Energy Monitoring'),
            titlePosition: 'center',
          }}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primaryColor} />
          <Text style={styles.loadingText}>{t('Loading monitoring data...')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header
        options={{
          title: t('Energy Monitoring'),
          titlePosition: 'center',
          rightComponents: [
            <TouchableOpacity key="refresh" style={styles.headerButton} onPress={handleRefresh}>
              <Ionicons
                name={isRefreshing ? 'sync' : 'sync-outline'}
                size={24}
                color={colors.COLOR_BLACK}
                style={isRefreshing && styles.rotatingIcon}
              />
            </TouchableOpacity>,
          ],
        }}
      />

      <ScrollView style={styles.scrollView}>
        <View style={styles.propertyCard}>
          <View style={styles.propertyIconContainer}>
            <Ionicons name="home" size={32} color={colors.primaryColor} />
          </View>
          <View style={styles.propertyInfoContainer}>
            <Text style={styles.propertyName}>{propertyName}</Text>
            <Text style={styles.propertyAddress}>123 Green Street, Barcelona</Text>
            <View style={styles.ecoRatingContainer}>
              <Text style={styles.ecoRatingLabel}>{t('Energy Rating')}:</Text>
              <View style={[styles.ecoRatingBadge, { backgroundColor: '#4CAF50' }]}>
                <Text style={styles.ecoRatingText}>A+</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.utilityToggleContainer}>
          <TouchableOpacity
            style={[
              styles.utilityButton,
              selectedUtility === 'electricity' && {
                backgroundColor: 'rgba(255, 193, 7, 0.1)',
                borderColor: '#FFC107',
              },
            ]}
            onPress={() => setSelectedUtility('electricity')}
          >
            <Ionicons name="flash" size={24} color="#FFC107" />
            <Text style={styles.utilityButtonText}>{t('Electricity')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.utilityButton,
              selectedUtility === 'water' && {
                backgroundColor: 'rgba(33, 150, 243, 0.1)',
                borderColor: '#2196F3',
              },
            ]}
            onPress={() => setSelectedUtility('water')}
          >
            <Ionicons name="water" size={24} color="#2196F3" />
            <Text style={styles.utilityButtonText}>{t('Water')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.utilityButton,
              selectedUtility === 'gas' && {
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                borderColor: '#4CAF50',
              },
            ]}
            onPress={() => setSelectedUtility('gas')}
          >
            <Ionicons name="flame" size={24} color="#4CAF50" />
            <Text style={styles.utilityButtonText}>{t('Gas')}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.utilizationCard, { backgroundColor: utilityInfo.background }]}>
          <View style={styles.utilizationHeader}>
            <View style={styles.utilizationTitleContainer}>
              <Ionicons name={utilityInfo.icon as any} size={24} color={utilityInfo.color} />
              <Text style={[styles.utilizationTitle, { color: utilityInfo.color }]}>
                {t(selectedUtility.charAt(0).toUpperCase() + selectedUtility.slice(1))}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.compareButton, { borderColor: utilityInfo.color }]}
              onPress={handleCompare}
            >
              <Text style={[styles.compareButtonText, { color: utilityInfo.color }]}>
                {t('Compare')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.utilizationStats}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>{t('Current')}</Text>
              <Text style={styles.statValue}>
                {utilityInfo.currentUsage} {utilityInfo.unit}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>{t('Average')}</Text>
              <Text style={styles.statValue}>
                {utilityInfo.averageUsage} {utilityInfo.unit}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>{t('Change')}</Text>
              <Text
                style={[
                  styles.statValue,
                  { color: utilityInfo.change < 0 ? '#4CAF50' : '#F44336' },
                ]}
              >
                {utilityInfo.change}%
              </Text>
            </View>
          </View>

          <View style={styles.savingsContainer}>
            <Ionicons name="trending-down" size={20} color="#4CAF50" />
            <Text style={styles.savingsText}>
              {t("You're saving")} {utilityInfo.savings}
            </Text>
          </View>

          <View style={styles.chartContainer}>
            <LineChart
              data={utilityInfo.data}
              width={screenWidth - 40}
              height={220}
              chartConfig={chartConfig}
              bezier
              style={styles.chart}
            />
          </View>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: utilityInfo.color }]}
            onPress={() =>
              router.push(`/properties/${propertyId}/usage-history?type=${selectedUtility}`)
            }
          >
            <Text style={styles.actionButtonText}>{t('View Detailed History')}</Text>
            <Ionicons name="chevron-forward" size={16} color="white" />
          </TouchableOpacity>
        </View>

        <View style={styles.sectionTitle}>
          <Text style={styles.sectionTitleText}>{t('Energy Saving Tips')}</Text>
          <TouchableOpacity onPress={() => router.push('/education/energy-tips')}>
            <Text style={styles.seeAllText}>{t('See All')}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tipsScrollContent}
        >
          {energyTips.map((tip) => (
            <View key={tip.id} style={styles.tipCard}>
              <View style={styles.tipIconContainer}>
                <Ionicons name={tip.icon as any} size={24} color="#4CAF50" />
              </View>
              <Text style={styles.tipTitle}>{tip.title}</Text>
              <Text style={styles.tipDescription}>{tip.description}</Text>
              <Text style={styles.tipSavings}>{tip.savings}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.sectionTitle}>
          <Text style={styles.sectionTitleText}>{t('Smart Home Integration')}</Text>
        </View>

        <View style={styles.smartHomeCard}>
          <View style={styles.smartHomeHeader}>
            <View style={styles.smartHomeIconContainer}>
              <Ionicons name="wifi" size={24} color="#9C27B0" />
            </View>
            <View style={styles.smartHomeContent}>
              <Text style={styles.smartHomeTitle}>{t('Connect Smart Devices')}</Text>
              <Text style={styles.smartHomeDescription}>
                {t(
                  'Link your smart home devices to monitor and control energy usage in real-time.',
                )}
              </Text>
            </View>
          </View>
          <TouchableOpacity style={styles.smartHomeButton}>
            <Text style={styles.smartHomeButtonText}>{t('Connect Devices')}</Text>
            <Ionicons name="add-circle-outline" size={20} color={colors.primaryColor} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.issueButton} onPress={handleReportIssue}>
          <Ionicons name="alert-circle-outline" size={20} color={colors.primaryDark_1} />
          <Text style={styles.issueButtonText}>{t('Report Utility Issues')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primaryLight,
  },
  scrollView: {
    flex: 1,
  },
  headerButton: {
    padding: 8,
  },
  rotatingIcon: {
    transform: [{ rotate: '45deg' }],
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: colors.primaryDark_1,
  },
  propertyCard: {
    flexDirection: 'row',
    backgroundColor: 'white',
    margin: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  propertyIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(0, 92, 103, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  propertyInfoContainer: {
    flex: 1,
  },
  propertyName: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.primaryDark,
    marginBottom: 4,
  },
  propertyAddress: {
    fontSize: 14,
    color: colors.primaryDark_1,
    marginBottom: 8,
  },
  ecoRatingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ecoRatingLabel: {
    fontSize: 14,
    color: colors.primaryDark_1,
    marginRight: 8,
  },
  ecoRatingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  ecoRatingText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  utilityToggleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  utilityButton: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginHorizontal: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_5,
    backgroundColor: 'white',
  },
  utilityButtonText: {
    fontSize: 12,
    color: colors.primaryDark,
    marginTop: 8,
  },
  utilizationCard: {
    margin: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  utilizationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  utilizationTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  utilizationTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
  },
  compareButton: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  compareButtonText: {
    fontSize: 12,
    fontWeight: '500',
  },
  utilizationStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: colors.primaryDark_1,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.COLOR_BLACK_LIGHT_5,
  },
  savingsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    borderRadius: 8,
    padding: 8,
    marginBottom: 16,
  },
  savingsText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#4CAF50',
  },
  chartContainer: {
    marginBottom: 16,
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 8,
  },
  chart: {
    marginVertical: 8,
    borderRadius: 12,
  },
  actionButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
  },
  sectionTitle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  sectionTitleText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  seeAllText: {
    fontSize: 14,
    color: colors.primaryColor,
  },
  tipsScrollContent: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  tipCard: {
    width: 220,
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  tipIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  tipTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryDark,
    marginBottom: 8,
  },
  tipDescription: {
    fontSize: 12,
    color: colors.primaryDark_1,
    marginBottom: 8,
    lineHeight: 18,
  },
  tipSavings: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4CAF50',
  },
  smartHomeCard: {
    margin: 16,
    borderRadius: 12,
    backgroundColor: 'white',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  smartHomeHeader: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  smartHomeIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(156, 39, 176, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  smartHomeContent: {
    flex: 1,
  },
  smartHomeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryDark,
    marginBottom: 4,
  },
  smartHomeDescription: {
    fontSize: 12,
    color: colors.primaryDark_1,
    lineHeight: 18,
  },
  smartHomeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 92, 103, 0.1)',
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  smartHomeButtonText: {
    color: colors.primaryColor,
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
  },
  issueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginBottom: 24,
    paddingVertical: 12,
  },
  issueButtonText: {
    fontSize: 14,
    color: colors.primaryDark_1,
    marginLeft: 8,
  },
});
