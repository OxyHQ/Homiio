import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
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
  i18nKey: string;
}

const STATUS_I18N: Record<StatusType, StatusInfo> = {
  draft: { icon: 'document-outline', color: colors.COLOR_BLACK_LIGHT_3, badgeColor: 'default', i18nKey: 'status.draft' },
  pending: { icon: 'hourglass-outline', color: colors.warning, badgeColor: 'warning', i18nKey: 'status.pending' },
  pending_signatures: { icon: 'create-outline', color: colors.warning, badgeColor: 'warning', i18nKey: 'status.pendingSignatures' },
  active: { icon: 'checkmark-circle', color: colors.success, badgeColor: 'success', i18nKey: 'status.active' },
  expired: { icon: 'calendar-outline', color: colors.textTertiary, badgeColor: 'default', i18nKey: 'status.expired' },
  terminated: { icon: 'close-circle-outline', color: colors.danger, badgeColor: 'error', i18nKey: 'status.terminated' },
  cancelled: { icon: 'close-circle-outline', color: colors.textTertiary, badgeColor: 'default', i18nKey: 'status.cancelled' },
  processing: { icon: 'reload-outline', color: colors.info, badgeColor: 'info', i18nKey: 'status.processing' },
  completed: { icon: 'checkmark-circle', color: colors.success, badgeColor: 'success', i18nKey: 'status.completed' },
  failed: { icon: 'close-circle-outline', color: colors.danger, badgeColor: 'error', i18nKey: 'status.failed' },
  refunded: { icon: 'refresh-circle-outline', color: colors.textTertiary, badgeColor: 'default', i18nKey: 'status.refunded' },
  success: { icon: 'checkmark-circle', color: colors.success, badgeColor: 'success', i18nKey: 'status.success' },
  warning: { icon: 'warning', color: colors.warning, badgeColor: 'warning', i18nKey: 'status.warning' },
  error: { icon: 'close-circle-outline', color: colors.danger, badgeColor: 'error', i18nKey: 'status.error' },
  info: { icon: 'information-circle-outline', color: colors.info, badgeColor: 'info', i18nKey: 'status.info' },
  investigating: { icon: 'search-outline', color: colors.warning, badgeColor: 'warning', i18nKey: 'status.investigating' },
  resolved: { icon: 'checkmark-circle', color: colors.success, badgeColor: 'success', i18nKey: 'status.resolved' },
  online: { icon: 'radio-button-on', color: colors.success, badgeColor: 'success', i18nKey: 'status.online' },
  offline: { icon: 'radio-button-off', color: colors.textTertiary, badgeColor: 'default', i18nKey: 'status.offline' },
};

function getStatusInfo(status: StatusType): StatusInfo {
  return STATUS_I18N[status] ?? {
    icon: 'help-circle-outline',
    color: colors.COLOR_BLACK_LIGHT_3,
    badgeColor: 'default',
    i18nKey: 'status.unknown',
  };
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
  const { t } = useTranslation();
  const statusInfo = getStatusInfo(status);
  const finalColor = customColor || statusInfo.color;
  const finalIcon = (customIcon as IoniconName | undefined) || statusInfo.icon;
  const finalText = customText || t(statusInfo.i18nKey);

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
