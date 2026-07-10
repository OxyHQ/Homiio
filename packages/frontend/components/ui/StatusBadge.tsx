import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Badge, type BadgeColor, type BadgeSize } from '@oxyhq/bloom/badge';
import { colors } from '@/styles/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export type StatusType =
  | 'draft'
  | 'pending'
  | 'pending_signatures'
  | 'active'
  | 'expired'
  | 'terminated'
  | 'cancelled'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'refunded'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
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

const STATUS_I18N: Record<StatusType, string> = {
  draft: 'statusBadge.draft',
  pending: 'statusBadge.pending',
  pending_signatures: 'statusBadge.pendingSignatures',
  active: 'statusBadge.active',
  expired: 'statusBadge.expired',
  terminated: 'statusBadge.terminated',
  cancelled: 'statusBadge.cancelled',
  processing: 'statusBadge.processing',
  completed: 'statusBadge.completed',
  failed: 'statusBadge.failed',
  refunded: 'statusBadge.refunded',
  success: 'statusBadge.success',
  warning: 'statusBadge.warning',
  error: 'statusBadge.error',
  info: 'statusBadge.info',
  investigating: 'statusBadge.investigating',
  resolved: 'statusBadge.resolved',
  online: 'statusBadge.online',
  offline: 'statusBadge.offline',
};

function getStatusInfo(status: StatusType): StatusInfo {
  switch (status) {
    case 'draft':
      return { icon: 'document-outline', color: colors.COLOR_BLACK_LIGHT_3, badgeColor: 'default', i18nKey: STATUS_I18N.draft };
    case 'pending':
      return { icon: 'hourglass-outline', color: colors.warning, badgeColor: 'warning', i18nKey: STATUS_I18N.pending };
    case 'pending_signatures':
      return { icon: 'create-outline', color: colors.warning, badgeColor: 'warning', i18nKey: STATUS_I18N.pending_signatures };
    case 'active':
      return { icon: 'checkmark-circle', color: colors.success, badgeColor: 'success', i18nKey: STATUS_I18N.active };
    case 'expired':
      return { icon: 'calendar-outline', color: colors.textTertiary, badgeColor: 'default', i18nKey: STATUS_I18N.expired };
    case 'terminated':
      return { icon: 'close-circle-outline', color: colors.danger, badgeColor: 'error', i18nKey: STATUS_I18N.terminated };
    case 'cancelled':
      return { icon: 'close-circle-outline', color: colors.textTertiary, badgeColor: 'default', i18nKey: STATUS_I18N.cancelled };
    case 'processing':
      return { icon: 'reload-outline', color: colors.info, badgeColor: 'info', i18nKey: STATUS_I18N.processing };
    case 'completed':
      return { icon: 'checkmark-circle', color: colors.success, badgeColor: 'success', i18nKey: STATUS_I18N.completed };
    case 'failed':
      return { icon: 'close-circle-outline', color: colors.danger, badgeColor: 'error', i18nKey: STATUS_I18N.failed };
    case 'refunded':
      return { icon: 'refresh-circle-outline', color: colors.textTertiary, badgeColor: 'default', i18nKey: STATUS_I18N.refunded };
    case 'success':
      return { icon: 'checkmark-circle', color: colors.success, badgeColor: 'success', i18nKey: STATUS_I18N.success };
    case 'warning':
      return { icon: 'warning', color: colors.warning, badgeColor: 'warning', i18nKey: STATUS_I18N.warning };
    case 'error':
      return { icon: 'close-circle-outline', color: colors.danger, badgeColor: 'error', i18nKey: STATUS_I18N.error };
    case 'info':
      return { icon: 'information-circle-outline', color: colors.info, badgeColor: 'info', i18nKey: STATUS_I18N.info };
    case 'investigating':
      return { icon: 'search-outline', color: colors.warning, badgeColor: 'warning', i18nKey: STATUS_I18N.investigating };
    case 'resolved':
      return { icon: 'checkmark-circle', color: colors.success, badgeColor: 'success', i18nKey: STATUS_I18N.resolved };
    case 'online':
      return { icon: 'radio-button-on', color: colors.success, badgeColor: 'success', i18nKey: STATUS_I18N.online };
    case 'offline':
      return { icon: 'radio-button-off', color: colors.textTertiary, badgeColor: 'default', i18nKey: STATUS_I18N.offline };
    default:
      return { icon: 'help-circle-outline', color: colors.COLOR_BLACK_LIGHT_3, badgeColor: 'default', i18nKey: 'statusBadge.unknown' };
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
  const { t } = useTranslation();
  const statusInfo = getStatusInfo(status);
  const finalColor = customColor || statusInfo.color;
  const finalIcon = (customIcon as IoniconName | undefined) || statusInfo.icon;
  const finalText = customText ?? t(statusInfo.i18nKey);

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
