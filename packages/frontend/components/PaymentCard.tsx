import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { StatusBadge, type StatusType } from './ui/StatusBadge';

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
export type PaymentType = 'rent' | 'deposit' | 'service' | 'fairCoin';

type PaymentCardProps = {
  id: string;
  amount: number;
  currency?: string;
  status: PaymentStatus;
  type: PaymentType;
  date: string;
  recipient: string;
  sender: string;
  propertyName?: string;
  description?: string;
  transactionId?: string;
  onViewPress?: () => void;
  onReceiptPress?: () => void;
};

export function PaymentCard({
  amount,
  currency = '⊜',
  status,
  type,
  date,
  recipient,
  sender,
  propertyName,
  description,
  transactionId,
  onViewPress,
  onReceiptPress,
}: PaymentCardProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getTypeInfo = (type: PaymentType) => {
    switch (type) {
      case 'rent':
        return {
          icon: 'home-outline',
          label: 'Rent Payment',
        };
      case 'deposit':
        return {
          icon: 'lock-closed-outline',
          label: 'Security Deposit',
        };
      case 'service':
        return {
          icon: 'hammer-outline',
          label: 'Service Fee',
        };
      case 'fairCoin':
        return {
          icon: 'logo-bitcoin',
          label: 'FairCoin Transfer',
        };
    }
  };

  const typeInfo = getTypeInfo(type);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.typeContainer}>
          <View style={styles.iconContainer}>
            <IconComponent name={typeInfo.icon} size={20} color={colors.primaryColor} />
          </View>
          <View>
            <Text style={styles.typeLabel}>{typeInfo.label}</Text>
            <Text style={styles.dateText}>{formatDate(date)}</Text>
          </View>
        </View>
        <StatusBadge status={status as StatusType} size="small" />
      </View>

      <Text style={styles.amount}>
        {currency}
        {amount.toLocaleString()}
      </Text>

      {propertyName && (
        <View style={styles.propertyRow}>
          <IconComponent name="home-outline" size={16} color={colors.primaryDark_1} />
          <Text style={styles.propertyName} numberOfLines={1}>
            {propertyName}
          </Text>
        </View>
      )}

      <View style={styles.partiesContainer}>
        <View style={styles.partyRow}>
          <Text style={styles.partyLabel}>From:</Text>
          <Text style={styles.partyName} numberOfLines={1}>
            {sender}
          </Text>
        </View>
        <View style={styles.partyRow}>
          <Text style={styles.partyLabel}>To:</Text>
          <Text style={styles.partyName} numberOfLines={1}>
            {recipient}
          </Text>
        </View>
      </View>

      {description && (
        <View style={styles.descriptionContainer}>
          <Text style={styles.descriptionLabel}>Description:</Text>
          <Text style={styles.descriptionText}>{description}</Text>
        </View>
      )}

      {transactionId && (
        <View style={styles.transactionRow}>
          <Text style={styles.transactionLabel}>Transaction ID:</Text>
          <Text style={styles.transactionId} numberOfLines={1}>
            {transactionId}
          </Text>
        </View>
      )}

      <View style={styles.actionsContainer}>
        <TouchableOpacity style={styles.actionButton} onPress={onViewPress}>
          <IconComponent name="eye-outline" size={18} color={colors.primaryColor} />
          <Text style={styles.actionText}>View Details</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={onReceiptPress}>
          <IconComponent name="document-text-outline" size={18} color={colors.primaryColor} />
          <Text style={styles.actionText}>Receipt</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 12,
    marginBottom: 16,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  typeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  typeLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryDark,
  },
  dateText: {
    fontSize: 12,
    color: colors.primaryDark_1,
  },
  amount: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primaryDark,
    marginBottom: 12,
  },
  propertyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  propertyName: {
    fontSize: 14,
    color: colors.primaryDark_1,
    marginLeft: 8,
  },
  partiesContainer: {
    marginBottom: 12,
    backgroundColor: colors.primaryLight,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_5,
  },
  partyRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  partyLabel: {
    fontSize: 14,
    color: colors.primaryDark_1,
    width: 50,
  },
  partyName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.primaryDark,
    flex: 1,
  },
  descriptionContainer: {
    marginBottom: 12,
  },
  descriptionLabel: {
    fontSize: 14,
    color: colors.primaryDark_1,
    marginBottom: 4,
  },
  descriptionText: {
    fontSize: 14,
    color: colors.primaryDark,
  },
  transactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  transactionLabel: {
    fontSize: 12,
    color: colors.primaryDark_1,
    marginRight: 4,
  },
  transactionId: {
    fontSize: 12,
    color: colors.primaryDark,
    flex: 1,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryColor,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 12,
  },
  actionText: {
    color: colors.primaryColor,
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 6,
  },
});
