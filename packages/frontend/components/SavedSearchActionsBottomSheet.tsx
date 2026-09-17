import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  RiDeleteBinLine,
  RiEditLine,
  RiNotification3Line,
  RiNotificationOffLine,
} from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { H3 } from '@oxy.so/bloom/typography';

import { spacing } from '@/constants/styles';
import { useColors } from '@/hooks/useThemeColor';

interface SavedSearch {
  id: string;
  name: string;
  query: string;
  notificationsEnabled?: boolean;
}

interface Props {
  search: SavedSearch;
  onClose: () => void;
  onEdit: (search: SavedSearch) => void;
  onToggleNotifications: (search: SavedSearch) => void;
  onDelete: (search: SavedSearch) => void;
}

const ICON_SIZE = 20;

/** The actions for one saved search, as Bloom rows in the app's sheet. */
export const SavedSearchActionsBottomSheet: React.FC<Props> = ({
  search,
  onClose,
  onEdit,
  onToggleNotifications,
  onDelete,
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const NotificationIcon = search.notificationsEnabled ? RiNotificationOffLine : RiNotification3Line;
  const notificationLabel = search.notificationsEnabled
    ? t('search.disableNotifications')
    : t('search.enableNotifications');

  return (
    <View style={styles.container}>
      <H3 style={styles.title} numberOfLines={1}>
        {search.name}
      </H3>

      <Item
        title={t('common.edit')}
        leading={<RiEditLine width={ICON_SIZE} height={ICON_SIZE} fill={colors.text} />}
        onPress={() => {
          onEdit(search);
          onClose();
        }}
        accessibilityLabel={t('common.edit')}
      />
      <Item
        title={notificationLabel}
        leading={<NotificationIcon width={ICON_SIZE} height={ICON_SIZE} fill={colors.text} />}
        onPress={() => {
          onToggleNotifications(search);
          onClose();
        }}
        accessibilityLabel={notificationLabel}
      />
      <Item
        title={t('common.delete')}
        destructive
        leading={<RiDeleteBinLine width={ICON_SIZE} height={ICON_SIZE} fill={colors.negative} />}
        onPress={() => {
          onDelete(search);
          onClose();
        }}
        accessibilityLabel={t('common.delete')}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
  },
  title: {
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
});
