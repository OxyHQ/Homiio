import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

export type StatusType =
  // Contract statuses
  | 'draft'
  | 'pending'
  | 'active'
  | 'expired'
  | 'terminated'
  // Payment statuses
  | 'processing'
  | 'completed'
  | 'failed'
  | 'refunded'
  // General statuses
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  // Custom statuses
  | 'investigating'
  | 'resolved'
  | 'online'
  | 'offline';

type StatusBadgeProps = {
  status: StatusType;
  size?: 'small' | 'medium' | 'large';
  showIcon?: boolean;
  showText?: boolean;
  style?: ViewStyle;
  customColor?: string;
  customIcon?: string;
  customText?: string;
};

export function StatusBadge({
  status,
  size = 'medium',
  showIcon = true,
  showText = true,
  style,
  customColor,
  customIcon,
  customText,
}: StatusBadgeProps) {
  const getStatusInfo = (status: StatusType) => {
    switch (status) {
      // Contract statuses
      case 'draft':
        return {
          icon: 'document-outline',
          color: colors.COLOR_BLACK_LIGHT_3,
          label: 'Draft',
        };
      case 'pending':
        return {
          icon: 'hourglass-outline',
          color: '#FFC107',
          label: 'Pending',
        };
      case 'active':
        return {
          icon: 'checkmark-circle',
          color: '#4CAF50',
          label: 'Active',
        };
      case 'expired':
        return {
          icon: 'calendar-outline',
          color: '#9E9E9E',
          label: 'Expired',
        };
      case 'terminated':
        return {
          icon: 'close-circle-outline',
          color: '#F44336',
          label: 'Terminated',
        };

      // Payment statuses
      case 'processing':
        return {
          icon: 'reload-outline',
          color: '#2196F3',
          label: 'Processing',
        };
      case 'completed':
        return {
          icon: 'checkmark-circle',
          color: '#4CAF50',
          label: 'Completed',
        };
      case 'failed':
        return {
          icon: 'close-circle-outline',
          color: '#F44336',
          label: 'Failed',
        };
      case 'refunded':
        return {
          icon: 'refresh-circle-outline',
          color: '#9E9E9E',
          label: 'Refunded',
        };

      // General statuses
      case 'success':
        return {
          icon: 'checkmark-circle',
          color: '#4CAF50',
          label: 'Success',
        };
      case 'warning':
        return {
          icon: 'warning',
          color: '#FFC107',
          label: 'Warning',
        };
      case 'error':
        return {
          icon: 'close-circle-outline',
          color: '#F44336',
          label: 'Error',
        };
      case 'info':
        return {
          icon: 'information-circle-outline',
          color: '#2196F3',
          label: 'Info',
        };

      // Custom statuses
      case 'investigating':
        return {
          icon: 'search-outline',
          color: '#FFC107',
          label: 'Investigating',
        };
      case 'resolved':
        return {
          icon: 'checkmark-circle',
          color: '#4CAF50',
          label: 'Resolved',
        };
      case 'online':
        return {
          icon: 'radio-button-on',
          color: '#4CAF50',
          label: 'Online',
        };
      case 'offline':
        return {
          icon: 'radio-button-off',
          color: '#9E9E9E',
          label: 'Offline',
        };

      default:
        return {
          icon: 'help-circle-outline',
          color: colors.COLOR_BLACK_LIGHT_3,
          label: 'Unknown',
        };
    }
  };

  const sizeStyles = {
    small: {
      container: { paddingHorizontal: 6, paddingVertical: 2 },
      icon: 10,
      text: { fontSize: 10 },
    },
    medium: {
      container: { paddingHorizontal: 8, paddingVertical: 4 },
      icon: 12,
      text: { fontSize: 12 },
    },
    large: {
      container: { paddingHorizontal: 10, paddingVertical: 6 },
      icon: 14,
      text: { fontSize: 14 },
    },
  };

  const statusInfo = getStatusInfo(status);
  const sizeStyle = sizeStyles[size];
  const finalColor = customColor || statusInfo.color;
  const finalIcon = customIcon || statusInfo.icon;
  const finalText = customText || statusInfo.label;

  return (
    <View style={[styles.container, sizeStyle.container, { backgroundColor: finalColor }, style]}>
      {showIcon && (
        <IconComponent name={finalIcon} size={sizeStyle.icon} color="white" style={styles.icon} />
      )}
      {showText && <Text style={[styles.text, sizeStyle.text]}>{finalText}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  icon: {
    marginRight: 4,
  },
  text: {
    color: 'white',
    fontWeight: '500',
  },
});
