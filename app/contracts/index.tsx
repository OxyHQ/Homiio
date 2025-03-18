import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';

type Contract = {
  id: string;
  propertyName: string;
  landlordName: string;
  startDate: string;
  endDate: string;
  monthlyRent: string;
  status: 'active' | 'pending' | 'expired' | 'upcoming';
  depositAmount: string;
  isEthical: boolean;
};

export default function ContractsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');

  useEffect(() => {
    // Simulating API call with a timeout
    const fetchContracts = setTimeout(() => {
      const mockContracts: Contract[] = [
        {
          id: '1',
          propertyName: 'Modern Studio Apartment',
          landlordName: 'Maria Garcia',
          startDate: '2023-01-01',
          endDate: '2023-12-31',
          monthlyRent: '€850',
          status: 'active',
          depositAmount: '€1700',
          isEthical: true,
        },
        {
          id: '2',
          propertyName: 'Co-living Space with Garden',
          landlordName: 'Thomas Weber',
          startDate: '2023-06-01',
          endDate: '2023-11-30',
          monthlyRent: '€550',
          status: 'pending',
          depositAmount: '€1100',
          isEthical: true,
        },
        {
          id: '3',
          propertyName: 'Spacious 2-Bedroom Apartment',
          landlordName: 'Johanna Schmidt',
          startDate: '2022-05-15',
          endDate: '2023-05-14',
          monthlyRent: '€1200',
          status: 'expired',
          depositAmount: '€2400',
          isEthical: false,
        },
        {
          id: '4',
          propertyName: 'City Center Loft',
          landlordName: 'Luis Rodriguez',
          startDate: '2023-12-01',
          endDate: '2024-11-30',
          monthlyRent: '€950',
          status: 'upcoming',
          depositAmount: '€1900',
          isEthical: true,
        },
      ];
      
      setContracts(mockContracts);
      setLoading(false);
    }, 1000);

    return () => clearTimeout(fetchContracts);
  }, []);

  const getStatusColor = (status: Contract['status']) => {
    switch (status) {
      case 'active':
        return '#4CAF50'; // green
      case 'pending':
        return '#FF9800'; // orange
      case 'expired':
        return '#9E9E9E'; // grey
      case 'upcoming':
        return '#2196F3'; // blue
      default:
        return colors.COLOR_BLACK;
    }
  };

  const getStatusText = (status: Contract['status']) => {
    switch (status) {
      case 'active':
        return t('Active');
      case 'pending':
        return t('Pending');
      case 'expired':
        return t('Expired');
      case 'upcoming':
        return t('Upcoming');
      default:
        return '';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const filteredContracts = contracts.filter(contract => {
    if (activeTab === 'active') {
      return contract.status === 'active' || contract.status === 'pending' || contract.status === 'upcoming';
    } else {
      return contract.status === 'expired';
    }
  });

  const renderContractItem = ({ item }: { item: Contract }) => (
    <TouchableOpacity
      style={styles.contractCard}
      onPress={() => router.push(`/contracts/${item.id}`)}
    >
      <View style={styles.contractHeader}>
        <Text style={styles.propertyName} numberOfLines={1}>{item.propertyName}</Text>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
          <Text style={styles.statusText}>{getStatusText(item.status)}</Text>
        </View>
      </View>
      
      <View style={styles.contractInfo}>
        <View style={styles.infoRow}>
          <Ionicons name="person-outline" size={16} color={colors.COLOR_BLACK_LIGHT_3} />
          <Text style={styles.infoText}>{item.landlordName}</Text>
        </View>
        
        <View style={styles.infoRow}>
          <Ionicons name="calendar-outline" size={16} color={colors.COLOR_BLACK_LIGHT_3} />
          <Text style={styles.infoText}>
            {formatDate(item.startDate)} - {formatDate(item.endDate)}
          </Text>
        </View>
        
        <View style={styles.infoRow}>
          <Ionicons name="cash-outline" size={16} color={colors.COLOR_BLACK_LIGHT_3} />
          <Text style={styles.infoText}>{item.monthlyRent}/month</Text>
        </View>
      </View>
      
      <View style={styles.contractFooter}>
        {item.isEthical ? (
          <View style={styles.ethicalBadge}>
            <Ionicons name="shield-checkmark" size={14} color={colors.primaryColor} />
            <Text style={styles.ethicalText}>{t('Ethical Contract')}</Text>
          </View>
        ) : (
          <View style={styles.nonEthicalBadge}>
            <Ionicons name="alert-circle" size={14} color="#FF5722" />
            <Text style={styles.nonEthicalText}>{t('Review Recommended')}</Text>
          </View>
        )}
        
        <TouchableOpacity style={styles.viewDetailsButton}>
          <Text style={styles.viewDetailsText}>{t('View Details')}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primaryColor} />
        </TouchableOpacity>
      </View>
      
      {item.status === 'active' && (
        <View style={styles.quickActionsContainer}>
          <TouchableOpacity style={styles.quickActionButton}>
            <Ionicons name="document-text-outline" size={18} color={colors.primaryColor} />
            <Text style={styles.quickActionText}>{t('Contract')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.quickActionButton}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primaryColor} />
            <Text style={styles.quickActionText}>{t('Contact')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.quickActionButton}>
            <Ionicons name="cash-outline" size={18} color={colors.primaryColor} />
            <Text style={styles.quickActionText}>{t('Pay Rent')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.quickActionButton}>
            <Ionicons name="construct-outline" size={18} color={colors.primaryColor} />
            <Text style={styles.quickActionText}>{t('Repairs')}</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {item.status === 'upcoming' && (
        <View style={styles.moveInReminderContainer}>
          <Ionicons name="information-circle" size={20} color={colors.primaryColor} />
          <Text style={styles.moveInReminderText}>
            {t('Move-in date')}: {formatDate(item.startDate)}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Header
        options={{
          title: t('Contracts'),
          titlePosition: 'center',
        }}
      />
      
      <View style={styles.container}>
        <View style={styles.tabsContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'active' && styles.activeTab]}
            onPress={() => setActiveTab('active')}
          >
            <Text style={[styles.tabText, activeTab === 'active' && styles.activeTabText]}>
              {t('Active')}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.tab, activeTab === 'history' && styles.activeTab]}
            onPress={() => setActiveTab('history')}
          >
            <Text style={[styles.tabText, activeTab === 'history' && styles.activeTabText]}>
              {t('History')}
            </Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.ethicalHousingInfo}>
          <Ionicons name="shield-checkmark" size={20} color={colors.primaryColor} />
          <Text style={styles.ethicalHousingText}>
            {t('Ethical contracts are reviewed for fair terms and transparency')}
          </Text>
          <TouchableOpacity style={styles.learnMoreButton}>
            <Text style={styles.learnMoreText}>{t('Learn More')}</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primaryColor} />
            <Text style={styles.loadingText}>{t('Loading contracts...')}</Text>
          </View>
        ) : filteredContracts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="document-text-outline" size={60} color={colors.COLOR_BLACK_LIGHT_3} />
            <Text style={styles.emptyText}>
              {activeTab === 'active'
                ? t('You have no active contracts')
                : t('No contract history found')}
            </Text>
            {activeTab === 'active' && (
              <TouchableOpacity
                style={styles.browsePropertiesButton}
                onPress={() => router.push('/properties')}
              >
                <Text style={styles.browsePropertiesText}>{t('Browse Properties')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <FlatList
            data={filteredContracts}
            renderItem={renderContractItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
      
      <TouchableOpacity 
        style={styles.helpButton}
        onPress={() => router.push('/support/legal')}
      >
        <Ionicons name="help-circle" size={24} color="white" />
      </TouchableOpacity>
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
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: colors.primaryLight,
    borderRadius: 8,
    marginBottom: 15,
    padding: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 6,
  },
  activeTab: {
    backgroundColor: colors.primaryColor,
  },
  tabText: {
    fontWeight: '600',
  },
  activeTabText: {
    color: 'white',
  },
  ethicalHousingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    padding: 12,
    borderRadius: 8,
    marginBottom: 15,
  },
  ethicalHousingText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
  },
  learnMoreButton: {},
  learnMoreText: {
    color: colors.primaryColor,
    fontWeight: '600',
  },
  listContainer: {
    paddingBottom: 20,
  },
  contractCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  contractHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  propertyName: {
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
    marginRight: 10,
  },
  statusBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  statusText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 12,
  },
  contractInfo: {
    marginBottom: 15,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoText: {
    marginLeft: 8,
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_1,
  },
  contractFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#eeeeee',
    paddingTop: 12,
  },
  ethicalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ethicalText: {
    marginLeft: 5,
    color: colors.primaryColor,
    fontWeight: '600',
    fontSize: 13,
  },
  nonEthicalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nonEthicalText: {
    marginLeft: 5,
    color: '#FF5722',
    fontWeight: '600',
    fontSize: 13,
  },
  viewDetailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewDetailsText: {
    color: colors.primaryColor,
    fontWeight: '600',
    marginRight: 5,
  },
  quickActionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 15,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#eeeeee',
  },
  quickActionButton: {
    alignItems: 'center',
  },
  quickActionText: {
    fontSize: 12,
    color: colors.primaryColor,
    marginTop: 5,
  },
  moveInReminderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    marginTop: 15,
    padding: 10,
    borderRadius: 8,
  },
  moveInReminderText: {
    marginLeft: 8,
    fontSize: 14,
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  emptyText: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_2,
    textAlign: 'center',
    marginTop: 15,
    marginBottom: 20,
  },
  browsePropertiesButton: {
    backgroundColor: colors.primaryColor,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  browsePropertiesText: {
    color: 'white',
    fontWeight: '600',
  },
  helpButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primaryColor,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
});