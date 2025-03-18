import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '@/components/Header';
import { ContractCard, ContractStatus } from '@/components/ContractCard';
import { colors } from '@/styles/colors';
import { SafeAreaView } from 'react-native-safe-area-context';

type Contract = {
  id: string;
  title: string;
  propertyId: string;
  propertyName: string;
  startDate: string;
  endDate: string;
  status: ContractStatus;
  landlordName: string;
  tenantName: string;
  monthlyRent: number;
  currency?: string;
};

// Sample data for demonstration
const sampleContracts: Contract[] = [
  {
    id: '1',
    title: 'Apartment Rental Agreement',
    propertyId: 'prop1',
    propertyName: 'Modern Studio in Barcelona',
    startDate: '2023-01-01',
    endDate: '2023-12-31',
    status: 'active',
    landlordName: 'Maria Garcia',
    tenantName: 'John Smith',
    monthlyRent: 850,
    currency: '€',
  },
  {
    id: '2',
    title: 'Co-living Space Agreement',
    propertyId: 'prop2',
    propertyName: 'Shared Apartment in Berlin',
    startDate: '2023-02-15',
    endDate: '2023-08-15',
    status: 'pending',
    landlordName: 'Klaus Schmidt',
    tenantName: 'John Smith',
    monthlyRent: 600,
    currency: '€',
  },
  {
    id: '3',
    title: 'House Rental Agreement',
    propertyId: 'prop3',
    propertyName: 'Family Home in Stockholm',
    startDate: '2022-05-01',
    endDate: '2023-05-01',
    status: 'expired',
    landlordName: 'Erik Johansson',
    tenantName: 'John Smith',
    monthlyRent: 1200,
    currency: '€',
  },
  {
    id: '4',
    title: 'Eco-Apartment Agreement',
    propertyId: 'prop4',
    propertyName: 'Sustainable Living in Amsterdam',
    startDate: '2023-03-01',
    endDate: '2024-03-01',
    status: 'active',
    landlordName: 'Jan de Vries',
    tenantName: 'John Smith',
    monthlyRent: 950,
    currency: '€',
  },
  {
    id: '5',
    title: 'Studio Agreement - Draft',
    propertyId: 'prop5',
    propertyName: 'Studio in Madrid',
    startDate: '2023-06-01',
    endDate: '2024-06-01',
    status: 'draft',
    landlordName: 'Carlos Rodriguez',
    tenantName: 'John Smith',
    monthlyRent: 750,
    currency: '€',
  },
];

type FilterOptions = 'all' | 'active' | 'pending' | 'expired' | 'draft';

export default function ContractsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterOptions>('all');

  // Filter contracts based on the selected filter
  const filteredContracts = sampleContracts.filter((contract) => {
    if (filter === 'all') return true;
    return contract.status === filter;
  });

  const handleContractPress = (contractId: string) => {
    router.push(`/contracts/${contractId}`);
  };

  const handleSharePress = (contractId: string) => {
    // In a real app, this would open a share dialog
    console.log(`Sharing contract ${contractId}`);
  };

  const handleDownloadPress = (contractId: string) => {
    // In a real app, this would download the contract document
    console.log(`Downloading contract ${contractId}`);
  };

  const handleAddNewContract = () => {
    router.push('/contracts/new');
  };

  const renderFilterButton = (label: string, value: FilterOptions) => (
    <TouchableOpacity
      style={[
        styles.filterButton,
        filter === value && styles.filterButtonActive
      ]}
      onPress={() => setFilter(value)}
    >
      <Text
        style={[
          styles.filterButtonText,
          filter === value && styles.filterButtonTextActive
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header
          options={{
            title: t("Contracts"),
            titlePosition: 'center',
          }}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primaryColor} />
          <Text style={styles.loadingText}>{t("Loading contracts...")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header
        options={{
          title: t("Rental Contracts"),
          titlePosition: 'center',
          rightComponents: [
            <TouchableOpacity key="add" style={styles.headerButton} onPress={handleAddNewContract}>
              <Ionicons name="add-circle-outline" size={24} color={colors.COLOR_BLACK} />
            </TouchableOpacity>,
          ],
        }}
      />

      <View style={styles.filterContainer}>
        {renderFilterButton(t('All'), 'all')}
        {renderFilterButton(t('Active'), 'active')}
        {renderFilterButton(t('Pending'), 'pending')}
        {renderFilterButton(t('Expired'), 'expired')}
        {renderFilterButton(t('Drafts'), 'draft')}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {filteredContracts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="document-text-outline" size={60} color={colors.COLOR_BLACK_LIGHT_3} />
            <Text style={styles.emptyText}>{t("No contracts found")}</Text>
            <Text style={styles.emptySubtext}>
              {filter === 'all' ?
                t("You don't have any rental contracts yet") :
                t(`You don't have any ${filter} contracts`)}
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={handleAddNewContract}
            >
              <Text style={styles.emptyButtonText}>{t("Create New Contract")}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filteredContracts.map((contract) => (
            <ContractCard
              key={contract.id}
              {...contract}
              onPress={() => handleContractPress(contract.id)}
              onSharePress={() => handleSharePress(contract.id)}
              onDownloadPress={() => handleDownloadPress(contract.id)}
            />
          ))
        )}
      </ScrollView>

      <View style={styles.bottomButtonContainer}>
        <TouchableOpacity
          style={styles.addButton}
          onPress={handleAddNewContract}
        >
          <Ionicons name="add" size={24} color="white" />
          <Text style={styles.addButtonText}>{t("New Contract")}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primaryLight,
  },
  headerButton: {
    padding: 8,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_5,
  },
  filterButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    marginHorizontal: 4,
  },
  filterButtonActive: {
    backgroundColor: colors.primaryColor,
  },
  filterButtonText: {
    fontSize: 14,
    color: colors.primaryDark_1,
  },
  filterButtonTextActive: {
    color: 'white',
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: 12,
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
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    marginTop: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.primaryDark,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.primaryDark_1,
    textAlign: 'center',
    marginBottom: 24,
  },
  emptyButton: {
    backgroundColor: colors.primaryColor,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
  },
  emptyButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  bottomButtonContainer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.COLOR_BLACK_LIGHT_5,
  },
  addButton: {
    backgroundColor: colors.primaryColor,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
    marginLeft: 8,
  },
});