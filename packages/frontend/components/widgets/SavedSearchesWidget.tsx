import React, { useState, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Modal,
  Switch,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import { webAlert } from '@/utils/api';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SavedSearchActionsBottomSheet } from '@/components/SavedSearchActionsBottomSheet';
import Button from '../Button';

// Define SavedSearch type locally since we're no longer using Redux
interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters?: {
    minPrice?: number;
    maxPrice?: number;
    bedrooms?: number;
    bathrooms?: number;
    propertyType?: string;
    location?: string;
    amenities?: string[];
  };
  createdAt: string;
  updatedAt: string;
  notificationsEnabled?: boolean;
}

// Type assertion for Ionicons compatibility
const IconComponent = Ionicons as any;

export function SavedSearchesWidget() {
  const { t } = useTranslation();
  const router = useRouter();
  const { searches, isAuthenticated, deleteSavedSearch, updateSearch, toggleNotifications } =
    useSavedSearches();

  // Actions modal state
  const [showActionsModal, setShowActionsModal] = useState(false);
  const [selectedSearch, setSelectedSearch] = useState<SavedSearch | null>(null);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingSearch, setEditingSearch] = useState<SavedSearch | null>(null);
  const [editName, setEditName] = useState('');
  const [editQuery, setEditQuery] = useState('');
  const [editNotificationsEnabled, setEditNotificationsEnabled] = useState(false);
  const [editError, setEditError] = useState('');

  const navigateToSearch = (search: SavedSearch) => {
    router.push(`/search/${encodeURIComponent(search.query)}`);
  };

  // Actions for saved searches using custom hook
  const bottomSheet = useContext(BottomSheetContext);
  const handleShowActions = (search: SavedSearch) => {
    setSelectedSearch(search);
    bottomSheet.openBottomSheet(
      <SavedSearchActionsBottomSheet
        search={{ id: search.id, name: search.name, query: search.query, notificationsEnabled: search.notificationsEnabled }}
        onClose={() => bottomSheet.closeBottomSheet()}
        onEdit={(s) => handleEditSearch(s as any)}
        onToggleNotifications={(s) => handleToggleSearchNotifications(s as any)}
        onDelete={(s) => handleDeleteSavedSearch(s as any)}
      />,
    );
  };

  const handleDeleteSavedSearch = async (search: SavedSearch) => {
    webAlert(t('search.deleteSearch'), t('search.deleteSearchConfirm', { name: search.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteSavedSearch(search.id, search.name);
          setShowActionsModal(false);
          setSelectedSearch(null);
        },
      },
    ]);
  };

  const handleEditSearch = (search: SavedSearch) => {
    setEditingSearch(search);
    setEditName(search.name);
    setEditQuery(search.query);
    setEditNotificationsEnabled(search.notificationsEnabled || false);
    setEditError('');
    setShowActionsModal(false);
    setShowEditModal(true);
  };

  const handleToggleSearchNotifications = async (search: SavedSearch) => {
    await toggleNotifications(search.id, !search.notificationsEnabled);
    setShowActionsModal(false);
    setSelectedSearch(null);
  };

  const handleEditSave = async () => {
    if (!editingSearch) return;

    setEditError('');

    if (!editName.trim()) {
      setEditError('Search name is required');
      return;
    }

    if (!editQuery.trim()) {
      setEditError('Search query is required');
      return;
    }

    try {
      await updateSearch(editingSearch.id, {
        name: editName.trim(),
        query: editQuery.trim(),
        filters: editingSearch.filters,
        notificationsEnabled: editNotificationsEnabled,
      });
      setShowEditModal(false);
      setEditingSearch(null);
    } catch {
      setEditError('Failed to update search');
    }
  };

  const handleEditClose = () => {
    setShowEditModal(false);
    setEditingSearch(null);
    setEditError('');
  };

  const renderSearchItem = ({ item }: { item: SavedSearch }) => (
    <TouchableOpacity style={styles.searchItem} onPress={() => navigateToSearch(item)}>
      <View style={styles.searchInfo}>
        <Text style={styles.searchName}>{item.name}</Text>
        <Text style={styles.searchCriteria}>{item.query}</Text>
      </View>
      <View style={styles.searchActions}>
        {item.notificationsEnabled && (
          <View style={styles.notificationBadge}>
            <IconComponent name="notifications" size={12} color={colors.primaryColor} />
          </View>
        )}
        <TouchableOpacity
          style={styles.actionsButton}
          onPress={() => handleShowActions(item)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <IconComponent name="ellipsis-vertical" size={16} color={colors.COLOR_BLACK_LIGHT_4} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  if (!isAuthenticated) {
    return (
      <BaseWidget
        title={t('Saved Searches')}
        icon={<IconComponent name="bookmark" size={22} color={colors.primaryColor} />}
      >
        <View style={styles.container}>
          <Text style={styles.emptyText}>{t('Sign in to save searches')}</Text>
          <Button onPress={() => router.push('/search')}>
            {t('Go to Search')}
          </Button>
        </View>
      </BaseWidget>
    );
  }

  if (searches.length === 0) {
    return (
      <BaseWidget
        title={t('Saved Searches')}
        icon={<IconComponent name="bookmark" size={22} color={colors.primaryColor} />}
      >
        <View style={styles.container}>
          <Text style={styles.emptyText}>{t('No saved searches yet')}</Text>
          <Button onPress={() => router.push('/search')}>
            {t('Create New Search')}
          </Button>
        </View>
      </BaseWidget>
    );
  }

  return (
    <>
      <BaseWidget
        title={t('Saved Searches')}
        icon={<IconComponent name="bookmark" size={22} color={colors.primaryColor} />}
      >
        <View style={styles.container}>
          <FlatList
            data={searches.slice(0, 3)}
            renderItem={renderSearchItem}
            keyExtractor={(item) => item.id || Math.random().toString()}
            scrollEnabled={false}
          />

          {searches.length > 3 && (
            <Button onPress={() => router.push('/saved?tab=searches')}>
              {`${t('View All')} (${searches.length - 3} ${t('more')})`}
            </Button>
          )}

          <Button onPress={() => router.push('/search')}>
            {t('Create New Search')}
          </Button>
        </View>
      </BaseWidget>

      {/* Actions Modal for Saved Searches */}
      <Modal
        visible={showActionsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowActionsModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowActionsModal(false)}
        >
          <View style={styles.actionsContainer}>
            {selectedSearch && (
              <>
                <TouchableOpacity
                  style={styles.actionItem}
                  onPress={() => handleEditSearch(selectedSearch)}
                >
                  <IconComponent name="create-outline" size={20} color={colors.primaryColor} />
                  <Text style={styles.actionText}>{t('common.edit')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionItem}
                  onPress={() => handleToggleSearchNotifications(selectedSearch)}
                >
                  <IconComponent
                    name={
                      selectedSearch.notificationsEnabled
                        ? 'notifications-off-outline'
                        : 'notifications-outline'
                    }
                    size={20}
                    color={colors.primaryColor}
                  />
                  <Text style={styles.actionText}>
                    {selectedSearch.notificationsEnabled
                      ? t('search.disableNotifications')
                      : t('search.enableNotifications')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionItem}
                  onPress={() => handleDeleteSavedSearch(selectedSearch)}
                >
                  <IconComponent name="trash-outline" size={20} color="#ff4757" />
                  <Text style={[styles.actionText, styles.deleteText]}>{t('common.delete')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Edit Search Modal */}
      <Modal
        visible={showEditModal}
        transparent
        animationType="slide"
        onRequestClose={handleEditClose}
      >
        <View style={styles.editModalOverlay}>
          <View style={styles.editModalContent}>
            {/* Header */}
            <View style={styles.editModalHeader}>
              <Text style={styles.editModalTitle}>{t('search.editSearch')}</Text>
              <TouchableOpacity onPress={handleEditClose} style={styles.closeButton}>
                <IconComponent name="close" size={24} color={colors.COLOR_BLACK_LIGHT_3} />
              </TouchableOpacity>
            </View>

            {/* Search Name Input */}
            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>{t('search.searchName')}</Text>
              <TextInput
                style={[styles.textInput, editError ? styles.textInputError : null]}
                placeholder={t('search.searchNamePlaceholder')}
                value={editName}
                onChangeText={(text) => {
                  setEditName(text);
                  if (editError) setEditError('');
                }}
                maxLength={50}
                autoFocus
              />
            </View>

            {/* Search Query Input */}
            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>{t('search.searchQuery')}</Text>
              <TextInput
                style={[styles.textInput, editError ? styles.textInputError : null]}
                placeholder={t('search.searchQueryPlaceholder')}
                value={editQuery}
                onChangeText={(text) => {
                  setEditQuery(text);
                  if (editError) setEditError('');
                }}
                multiline
                numberOfLines={2}
              />
            </View>

            {/* Notifications Toggle */}
            <View style={styles.toggleSection}>
              <View style={styles.toggleContent}>
                <View style={styles.toggleTextContainer}>
                  <Text style={styles.toggleTitle}>{t('search.enableNotifications')}</Text>
                  <Text style={styles.toggleDescription}>
                    {t('search.notificationsDescription')}
                  </Text>
                </View>
                <Switch
                  value={editNotificationsEnabled}
                  onValueChange={setEditNotificationsEnabled}
                  trackColor={{
                    false: colors.COLOR_BLACK_LIGHT_5,
                    true: colors.primaryColor + '40',
                  }}
                  thumbColor={editNotificationsEnabled ? colors.primaryColor : '#ffffff'}
                />
              </View>
            </View>

            {editError ? <Text style={styles.errorText}>{editError}</Text> : null}

            {/* Actions */}
            <View style={styles.actionButtons}>
              <Button
                onPress={handleEditClose}
                textColor={colors.COLOR_BLACK_LIGHT_4}
              >
                {t('common.cancel')}
              </Button>

              <Button
                onPress={handleEditSave}
                disabled={!editName.trim() || !editQuery.trim()}
              >
                {t('common.save')}
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  searchItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
  },
  searchInfo: {
    flex: 1,
  },
  searchName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  searchCriteria: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  searchActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  notificationBadge: {
    backgroundColor: colors.primaryColor + '20',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  actionsButton: {
    padding: 8,
  },
  emptyText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
    marginVertical: 12,
    lineHeight: 20,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionsContainer: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 8,
    minWidth: 200,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
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
  // Edit Modal Styles
  editModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  editModalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  editModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  editModalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  closeButton: {
    padding: 4,
  },
  inputSection: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.COLOR_BLACK_LIGHT_4,
    marginBottom: 8,
  },
  textInput: {
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_5,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_4,
    backgroundColor: colors.COLOR_BACKGROUND,
  },
  textInputError: {
    borderColor: '#ff4757',
  },
  toggleSection: {
    marginBottom: 20,
  },
  toggleContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleTextContainer: {
    flex: 1,
    marginRight: 16,
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.COLOR_BLACK_LIGHT_4,
    marginBottom: 4,
  },
  toggleDescription: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 20,
  },
  errorText: {
    color: '#ff4757',
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
});
