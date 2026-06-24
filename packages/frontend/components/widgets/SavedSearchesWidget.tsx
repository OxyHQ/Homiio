import React, { useContext, useState } from 'react';
import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { Button } from '@oxyhq/bloom/button';
import { Switch } from '@oxyhq/bloom/switch';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { TextFieldInput } from '@oxyhq/bloom/text-field';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { colors } from '@/styles/colors';
import { ICON_SIZES, radius, spacing } from '@/constants/styles';
import { BaseWidget } from './BaseWidget';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import { webAlert } from '@/utils/api';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SavedSearchActionsBottomSheet } from '@/components/SavedSearchActionsBottomSheet';
import type { SavedSearch } from '@/store/savedSearchesStore';

const HEADER_ICON_SIZE = 22;
/** Saved-search rows shown inline before the "View All" overflow. */
const PREVIEW_COUNT = 3;
/** Alpha suffix turning the brand color into a soft badge fill. */
const BADGE_ALPHA = '20';
/** Skeleton row placeholders rendered during the initial fetch. */
const SKELETON_ROWS = [0, 1, 2];

/** Header chrome shared by every state of the widget. */
const headerIcon = (
  <Ionicons name="bookmark" size={HEADER_ICON_SIZE} color={colors.primaryColor} />
);

/**
 * A single saved-search row. The whole row opens the actions bottom sheet; a
 * bell marks rows with notifications enabled and a chevron hints the tap
 * affordance. Stateless, so it is safe to render from `FlatList`/`.map()`.
 */
function SavedSearchRow({
  search,
  onPress,
}: {
  search: SavedSearch;
  onPress: (search: SavedSearch) => void;
}) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onPress(search)}
      accessibilityRole="button"
      accessibilityLabel={search.name}
    >
      <View style={styles.rowText}>
        <BloomText style={styles.rowName} numberOfLines={1}>
          {search.name}
        </BloomText>
        {!!search.query && (
          <BloomText style={styles.rowCriteria} numberOfLines={1}>
            {search.query}
          </BloomText>
        )}
      </View>
      {search.notificationsEnabled && (
        <View style={styles.bellBadge}>
          <Ionicons name="notifications" size={ICON_SIZES.xs} color={colors.primaryColor} />
        </View>
      )}
      <Ionicons name="chevron-forward" size={ICON_SIZES.md} color={colors.COLOR_BLACK_LIGHT_5} />
    </TouchableOpacity>
  );
}

export function SavedSearchesWidget() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showBottomSheet } = useOxy();
  const {
    searches,
    isLoading,
    error,
    isAuthenticated,
    deleteSavedSearch,
    updateSearch,
    toggleNotifications,
  } = useSavedSearches();

  // Edit modal state (reachable via the actions bottom sheet).
  const [editingSearch, setEditingSearch] = useState<SavedSearch | null>(null);
  const [editName, setEditName] = useState('');
  const [editQuery, setEditQuery] = useState('');
  const [editNotificationsEnabled, setEditNotificationsEnabled] = useState(false);
  const [nameError, setNameError] = useState('');
  const [queryError, setQueryError] = useState('');

  // The bottom sheet emits a lightweight `{ id, ... }` shape, so resolve the
  // full, typed SavedSearch from `searches` by id before handing it to the
  // handlers (avoids casting a partial to the full type).
  const bottomSheet = useContext(BottomSheetContext);
  const withResolvedSearch =
    (handler: (search: SavedSearch) => void) =>
    (partial: { id: string }) => {
      const resolved = searches.find((s) => s.id === partial.id);
      if (resolved) handler(resolved);
    };

  const handleShowActions = (search: SavedSearch) => {
    bottomSheet.openBottomSheet(
      <SavedSearchActionsBottomSheet
        search={{
          id: search.id,
          name: search.name,
          query: search.query,
          notificationsEnabled: search.notificationsEnabled,
        }}
        onClose={() => bottomSheet.closeBottomSheet()}
        onEdit={withResolvedSearch(handleEditSearch)}
        onToggleNotifications={withResolvedSearch(handleToggleSearchNotifications)}
        onDelete={withResolvedSearch(handleDeleteSavedSearch)}
      />,
    );
  };

  const handleDeleteSavedSearch = (search: SavedSearch) => {
    webAlert(t('search.deleteSearch'), t('search.deleteSearchConfirm', { name: search.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        // The hook surfaces its own success/error toast; nothing to do here.
        onPress: () => {
          void deleteSavedSearch(search.id, search.name);
        },
      },
    ]);
  };

  const handleEditSearch = (search: SavedSearch) => {
    setEditingSearch(search);
    setEditName(search.name);
    setEditQuery(search.query);
    setEditNotificationsEnabled(search.notificationsEnabled ?? false);
    setNameError('');
    setQueryError('');
  };

  const handleToggleSearchNotifications = (search: SavedSearch) => {
    void toggleNotifications(search.id, !search.notificationsEnabled);
  };

  const handleEditSave = async () => {
    if (!editingSearch) return;

    const name = editName.trim();
    const query = editQuery.trim();
    const nextNameError = name ? '' : t('search.widgets.savedSearches.nameRequired');
    const nextQueryError = query ? '' : t('search.widgets.savedSearches.queryRequired');
    setNameError(nextNameError);
    setQueryError(nextQueryError);
    if (nextNameError || nextQueryError) return;

    // `updateSearch` resolves to a boolean and fires its own toast; only close
    // the modal once the persist actually succeeded.
    const success = await updateSearch(editingSearch.id, {
      name,
      query,
      filters: editingSearch.filters,
      notificationsEnabled: editNotificationsEnabled,
    });
    if (success) handleEditClose();
  };

  const handleEditClose = () => {
    setEditingSearch(null);
    setNameError('');
    setQueryError('');
  };

  const renderState = () => {
    if (!isAuthenticated) {
      return (
        <View style={styles.stateBlock}>
          <Ionicons name="bookmark-outline" size={ICON_SIZES.xl} color={colors.COLOR_BLACK_LIGHT_5} />
          <BloomText style={styles.stateText}>
            {t('search.widgets.savedSearches.signInPrompt')}
          </BloomText>
          <Button variant="primary" size="medium" onPress={() => showBottomSheet?.('OxyAuth')}>
            {t('search.widgets.common.signIn')}
          </Button>
        </View>
      );
    }

    if (isLoading && searches.length === 0) {
      return (
        <View style={styles.skeletonList}>
          {SKELETON_ROWS.map((key) => (
            <View key={key} style={styles.skeletonRow}>
              <View style={styles.skeletonTextCol}>
                <Skeleton.Box width="60%" height={14} borderRadius={radius.md} />
                <Skeleton.Box width="85%" height={12} borderRadius={radius.md} />
              </View>
              <Skeleton.Circle size={ICON_SIZES.md} />
            </View>
          ))}
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.stateBlock}>
          <Ionicons name="cloud-offline-outline" size={ICON_SIZES.xl} color={colors.danger} />
          <BloomText style={styles.stateText}>
            {t('search.widgets.savedSearches.loadError')}
          </BloomText>
          <Button
            variant="secondary"
            size="medium"
            onPress={() => queryClient.invalidateQueries({ queryKey: ['savedSearches'] })}
          >
            {t('search.widgets.common.error')}
          </Button>
        </View>
      );
    }

    if (searches.length === 0) {
      return (
        <View style={styles.stateBlock}>
          <Ionicons name="bookmark-outline" size={ICON_SIZES.xl} color={colors.COLOR_BLACK_LIGHT_5} />
          <BloomText style={styles.stateText}>{t('search.widgets.savedSearches.empty')}</BloomText>
          <BloomText style={styles.stateHelper}>
            {t('search.widgets.savedSearches.emptyHelper')}
          </BloomText>
          <Button variant="primary" size="medium" onPress={() => router.push('/explore')}>
            {t('search.widgets.savedSearches.createNew')}
          </Button>
        </View>
      );
    }

    const remaining = searches.length - PREVIEW_COUNT;
    return (
      <View style={styles.listBlock}>
        <View>
          {searches.slice(0, PREVIEW_COUNT).map((item, index) => (
            <SavedSearchRow
              key={item.id ?? `${item.name}-${index}`}
              search={item}
              onPress={handleShowActions}
            />
          ))}
        </View>

        <View style={styles.footer}>
          <Button variant="primary" size="medium" onPress={() => router.push('/explore')}>
            {t('search.widgets.savedSearches.createNew')}
          </Button>
          {remaining > 0 && (
            <Button
              variant="ghost"
              size="medium"
              onPress={() => router.push('/saved?tab=searches')}
            >
              {t('search.widgets.savedSearches.viewAllCount', { count: remaining })}
            </Button>
          )}
        </View>
      </View>
    );
  };

  return (
    <>
      <BaseWidget title={t('search.widgets.savedSearches.title')} icon={headerIcon}>
        {renderState()}
      </BaseWidget>

      <Modal
        visible={!!editingSearch}
        transparent
        animationType="slide"
        onRequestClose={handleEditClose}
      >
        <View style={styles.editOverlay}>
          <View style={styles.editCard}>
            <View style={styles.editHeader}>
              <BloomText style={styles.editTitle}>
                {t('search.widgets.savedSearches.editTitle')}
              </BloomText>
              <TouchableOpacity
                onPress={handleEditClose}
                style={styles.closeButton}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
              >
                <Ionicons name="close" size={ICON_SIZES.lg} color={colors.COLOR_BLACK_LIGHT_3} />
              </TouchableOpacity>
            </View>

            <View style={styles.field}>
              <TextFieldInput
                label={t('search.widgets.savedSearches.nameLabel')}
                placeholder={t('search.widgets.savedSearches.namePlaceholder')}
                value={editName}
                onChangeText={(text) => {
                  setEditName(text);
                  if (nameError) setNameError('');
                }}
                isInvalid={!!nameError}
                maxLength={50}
                autoFocus
              />
              {!!nameError && <BloomText style={styles.fieldError}>{nameError}</BloomText>}
            </View>

            <View style={styles.field}>
              <TextFieldInput
                label={t('search.widgets.savedSearches.queryLabel')}
                placeholder={t('search.widgets.savedSearches.queryPlaceholder')}
                value={editQuery}
                onChangeText={(text) => {
                  setEditQuery(text);
                  if (queryError) setQueryError('');
                }}
                isInvalid={!!queryError}
                multiline
                numberOfLines={2}
              />
              {!!queryError && <BloomText style={styles.fieldError}>{queryError}</BloomText>}
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <BloomText style={styles.toggleTitle}>
                  {t('search.widgets.savedSearches.notificationsToggle')}
                </BloomText>
                <BloomText style={styles.toggleHelper}>
                  {t('search.widgets.savedSearches.notificationsHelper')}
                </BloomText>
              </View>
              <Switch value={editNotificationsEnabled} onValueChange={setEditNotificationsEnabled} />
            </View>

            <View style={styles.editActions}>
              <Button variant="secondary" size="medium" onPress={handleEditClose}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" size="medium" onPress={handleEditSave}>
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
  // List
  listBlock: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
  },
  rowText: {
    flex: 1,
    gap: spacing.xs / 2,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowCriteria: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  bellBadge: {
    backgroundColor: colors.primaryColor + BADGE_ALPHA,
    borderRadius: radius.pill,
    width: spacing.xl,
    height: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    gap: spacing.sm,
  },
  // Skeleton
  skeletonList: {
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  skeletonTextCol: {
    flex: 1,
    gap: spacing.sm,
  },
  // Shared empty / sign-in / error state
  stateBlock: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  stateText: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  stateHelper: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
    marginTop: -spacing.sm,
  },
  // Edit modal
  editOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  editCard: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing['2xl'],
    width: '100%',
    maxWidth: 400,
    gap: spacing.lg,
  },
  editHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  editTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  closeButton: {
    padding: spacing.xs,
  },
  field: {
    gap: spacing.sm,
  },
  fieldError: {
    color: colors.danger,
    fontSize: 13,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  toggleText: {
    flex: 1,
    gap: spacing.xs,
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  toggleHelper: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
  },
});
