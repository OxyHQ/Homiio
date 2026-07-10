import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Badge, type BadgeColor, type BadgeSize } from '@oxyhq/bloom/badge';
import { colors } from '@/styles/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export type StatusType =
  // Contract statuses
  | 'draft'
  | 'pending'
  | 'pending_signatures'
  | 'active'
  | 'expired'
  | 'terminated'
  | 'cancelled'
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

interface StatusInfo {
  icon: IoniconName;
  color: string;
  badgeColor: BadgeColor;
  label: string;
}

function getStatusInfo(status: StatusType): StatusInfo {
  switch (status) {
    // Contract statuses
    case 'draft':
      return { icon: 'document-outline', color: colors.COLOR_BLACK_LIGHT_3, badgeColor: 'default', label: 'Draft' };
    case 'pending':
      return { icon: 'hourglass-outline', color: colors.warning, badgeColor: 'warning', label: 'Pending' };
    case 'pending_signatures':
      return { icon: 'create-outline', color: colors.warning, badgeColor: 'warning', label: 'Pending signatures' };
    case 'active':
      return { icon: 'checkmark-circle', color: colors.success, badgeColor: 'success', label: 'Active' };
    case 'expired':
      return { icon: 'calendar-outline', color: colors.textTertiary, badgeColor: 'default', label: 'Expired' };
    case 'terminated':
      return { icon: 'close-circle-outline', color: colors.danger, badgeColor: 'error', label: 'Terminated' };
    case 'cancelled':
      return { icon: 'close-circle-outline', color: colors.textTertiary, badgeColor: 'default', label: 'Cancelled' };
    // Payment statuses
    case 'processing':
      return { icon: 'reload-outline', color: colors.info, badgeColor: 'info', label: 'Processing' };
    case 'completed':
      return { icon: 'checkmark-circle', color: colors.success, badgeColor: 'success', label: 'Completed' };
    case 'failed':
      return { icon: 'close-circle-outline', color: colors.danger, badgeColor: 'error', label: 'Failed' };
    case 'refunded':
      return { icon: 'refresh-circle-outline', color: colors.textTertiary, badgeColor: 'default', label: 'Refunded' };
    // General statuses
    case 'success':
      return { icon: 'checkmark-circle', color: colors.success, badgeColor: 'success', label: 'Success' };
    case 'warning':
      return { icon: 'warning', color: colors.warning, badgeColor: 'warning', label: 'Warning' };
    case 'error':
      return { icon: 'close-circle-outline', color: colors.danger, badgeColor: 'error', label: 'Error' };
    case 'info':
      return { icon: 'information-circle-outline', color: colors.info, badgeColor: 'info', label: 'Info' };
    // Custom statuses
    case 'investigating':
      return { icon: 'search-outline', color: colors.warning, badgeColor: 'warning', label: 'Investigating' };
    case 'resolved':
      return { icon: 'checkmark-circle', color: colors.success, badgeColor: 'success', label: 'Resolved' };
    case 'online':
      return { icon: 'radio-button-on', color: colors.success, badgeColor: 'success', label: 'Online' };
    case 'offline':
      return { icon: 'radio-button-off', color: colors.textTertiary, badgeColor: 'default', label: 'Offline' };
    default:
      return { icon: 'help-circle-outline', color: colors.COLOR_BLACK_LIGHT_3, badgeColor: 'default', label: 'Unknown' };
  }
}

const BADGE_SIZE_MAP: Record<'small' | 'medium' | 'large', BadgeSize> = {
  small: 'small',
  medium: 'medium',
  large: 'large',
};

const ICON_SIZE_MAP: Record<'small' | 'medium' | 'large', number> = {
  small: 10,
  medium: 12,
  large: 14,
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
  const statusInfo = getStatusInfo(status);
  const finalColor = customColor || statusInfo.color;
  const finalIcon = (customIcon as IoniconName | undefined) || statusInfo.icon;
  const finalText = customText || statusInfo.label;

  // When icon + text is desired with a custom override color, render a custom row
  // so we can keep the original Homiio look (solid bg + white icon + white text).
  if (showIcon && showText) {
    const iconSize = ICON_SIZE_MAP[size];
    const padding = size === 'small' ? 2 : size === 'large' ? 6 : 4;
    return (
      <View
        style={[
          styles.row,
          { paddingHorizontal: padding * 2, paddingVertical: padding, backgroundColor: finalColor },
          style,
        ]}
      >
        <Ionicons name={finalIcon} size={iconSize} color={colors.white} style={styles.icon} />
        <Text style={[styles.text, { fontSize: iconSize }]}>{finalText}</Text>
      </View>
    );
  }

  // Otherwise delegate to Bloom Badge.
  return (
    <Badge
      content={showText ? finalText : undefined}
      variant="solid"
      color={statusInfo.badgeColor}
      size={BADGE_SIZE_MAP[size]}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  icon: {
    marginRight: 4,
  },
  text: {
    color: colors.white,
    fontWeight: '500',
  },
});
