import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '@/components/Header';
import { ContractCard, ContractStatus } from '@/components/ContractCard';
import { colors } from '@/styles/colors';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUserLeases, useHasRentalProperties } from '@/hooks/useLeaseQueries';
import type { Lease } from '@/services/leaseService';

type FilterOptions = 'all' | 'active' | 'pending_signature' | 'expired' | 'draft';

export default function ContractsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [filter, setFilter] = useState<FilterOptions>('all');

  // Get user's leases and check if they have rental properties
  const { data: leasesData, isLoading: leasesLoading } = useUserLeases();
  const { hasRentalProperties, isLoading: hasPropertiesLoading } = useHasRentalProperties();

  // If user has no rental properties, show empty state
  if (!hasPropertiesLoading && !hasRentalProperties) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header
          options={{
            title: t("Rental Contracts"),
            titlePosition: 'center',
          }}
        />
        <View style={styles.emptyContainer}>
          <Ionicons name="document-text-outline" size={60} color={colors.COLOR_BLACK_LIGHT_3} />
          <Text style={styles.emptyText}>{t("No rental contracts")}</Text>
          <Text style={styles.emptySubtext}>
            {t("You don't have any rental properties yet. Start by browsing available properties or listing your own.")}
          </Text>
          <TouchableOpacity
            style={styles.emptyButton}
            onPress={() => router.push('/')}
          >
            <Text style={styles.emptyButtonText}>{t("Browse Properties")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Convert lease data to contract format for the ContractCard component
  const contracts = leasesData?.leases.map((lease: Lease) => ({
    id: lease.id,
    title: lease.property?.title || `Lease for ${lease.property?.address?.street || 'Property'}`,
    propertyId: lease.propertyId,
    propertyName: lease.property?.title || `${lease.property?.address?.street}, ${lease.property?.address?.city}`,
    startDate: lease.startDate,
    endDate: lease.endDate,
    status: lease.status as ContractStatus,
    landlordName: lease.landlord ? `${lease.landlord.firstName} ${lease.landlord.lastName}` : 'Unknown',
    tenantName: lease.tenant ? `${lease.tenant.firstName} ${lease.tenant.lastName}` : 'Unknown',
    monthlyRent: lease.rent.amount,
    currency: lease.rent.currency,
  })) || [];

  // Filter contracts based on the selected filter
  const filteredContracts = contracts.filter((contract) => {
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

  if (leasesLoading || hasPropertiesLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header
          options={{
            title: t("Rental Contracts"),
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
        {renderFilterButton(t('Pending'), 'pending_signature')}
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