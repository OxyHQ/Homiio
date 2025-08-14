import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { useTranslation } from 'react-i18next';

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

export const SavedSearchActionsBottomSheet: React.FC<Props> = ({
  search,
  onClose,
  onEdit,
  onToggleNotifications,
  onDelete,
}) => {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{search.name}</Text>

      <TouchableOpacity style={styles.actionItem} onPress={() => { onEdit(search); onClose(); }}>
        <Ionicons name="create-outline" size={20} color={colors.primaryColor} />
        <Text style={styles.actionText}>{t('common.edit')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.actionItem}
        onPress={() => { onToggleNotifications(search); onClose(); }}
      >
        <Ionicons
          name={search.notificationsEnabled ? 'notifications-off-outline' : 'notifications-outline'}
          size={20}
          color={colors.primaryColor}
        />
        <Text style={styles.actionText}>
          {search.notificationsEnabled ? t('search.disableNotifications') : t('search.enableNotifications')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.actionItem} onPress={() => { onDelete(search); onClose(); }}>
        <Ionicons name="trash-outline" size={20} color="#ff4757" />
        <Text style={[styles.actionText, styles.deleteText]}>{t('common.delete')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_4,
    marginBottom: 8,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  actionText: {
    marginLeft: 12,
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_4,
    fontWeight: '500',
  },
  deleteText: {
    color: '#ff4757',
  },
});


