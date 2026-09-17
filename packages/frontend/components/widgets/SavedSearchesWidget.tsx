import React, { useContext, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services';
import { Button } from '@oxy.so/bloom/button';
import { Dialog } from '@oxy.so/bloom/dialog';
import { Field } from '@oxy.so/bloom/field';
import {
  RiArrowRightSLine,
  RiBookmarkFill,
  RiBookmarkLine,
  RiErrorWarningFill,
  RiNotification3Fill,
} from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { Switch } from '@oxy.so/bloom/switch';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Textarea } from '@oxy.so/bloom/textarea';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { alert } from '@oxy.so/bloom/surfaces';
import { ICON_SIZES, radius } from '@/constants/styles';
import { useColors } from '@/hooks/useThemeColor';
import { BaseWidget } from './BaseWidget';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SavedSearchActionsBottomSheet } from '@/components/SavedSearchActionsBottomSheet';
import type { SavedSearch } from '@/store/savedSearchesStore';

const HEADER_ICON_SIZE = 22;
/** Saved-search rows shown inline before the "View All" overflow. */
const PREVIEW_COUNT = 3;
/** Skeleton row placeholders rendered during the initial fetch. */
const SKELETON_ROWS = [0, 1, 2];

/**
 * A single saved-search row: a Bloom `Item` whose press opens the actions
 * bottom sheet. A bell marks rows with notifications enabled and a chevron
 * hints the tap affordance. Stateless, so it is safe to render from `.map()`.
 */
function SavedSearchRow({
  search,
  onPress,
}: {
  search: SavedSearch;
  onPress: (search: SavedSearch) => void;
}) {
  const colors = useColors();
  return (
    <Item
      density="compact"
      title={search.name}
      subtitle={search.query ? search.query : undefined}
      onPress={() => onPress(search)}
      accessibilityRole="button"
      accessibilityLabel={search.name}
      trailing={
        <View className="flex-row items-center gap-2">
          {search.notificationsEnabled ? (
            <RiNotification3Fill width={ICON_SIZES.xs} height={ICON_SIZES.xs} fill={colors.primary} />
          ) : null}
          <RiArrowRightSLine width={ICON_SIZES.md} height={ICON_SIZES.md} fill={colors.textTertiary} />
        </View>
      }
    />
  );
}

/** Centred icon + message block shared by the sign-in, error and empty states. */
function StateBlock({ children }: { children: React.ReactNode }) {
  return <View className="items-center gap-3 py-3">{children}</View>;
}

export function SavedSearchesWidget() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const colors = useColors();
  const { openAccountDialog } = useOxy();
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
  const [submitting, setSubmitting] = useState(false);

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
    alert(t('search.deleteSearch'), t('search.deleteSearchConfirm', { name: search.name }), [
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
    // the dialog once the persist actually succeeded.
    setSubmitting(true);
    try {
      const success = await updateSearch(editingSearch.id, {
        name,
        query,
        filters: editingSearch.filters,
        notificationsEnabled: editNotificationsEnabled,
      });
      if (success) handleEditClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditClose = () => {
    setEditingSearch(null);
    setNameError('');
    setQueryError('');
  };

  const renderState = () => {
    if (!isAuthenticated) {
      return (
        <StateBlock>
          <RiBookmarkLine width={ICON_SIZES.xl} height={ICON_SIZES.xl} fill={colors.textTertiary} />
          <BloomText className="text-center text-[15px] font-semibold text-foreground">
            {t('search.widgets.savedSearches.signInPrompt')}
          </BloomText>
          <Button variant="primary" size="medium" onPress={() => openAccountDialog('signin')}>
            {t('search.widgets.common.signIn')}
          </Button>
        </StateBlock>
      );
    }

    if (isLoading && searches.length === 0) {
      return (
        <View className="gap-3 py-1">
          {SKELETON_ROWS.map((key) => (
            <View key={key} className="flex-row items-center gap-3">
              <View className="flex-1 gap-2">
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
        <StateBlock>
          <RiErrorWarningFill width={ICON_SIZES.xl} height={ICON_SIZES.xl} fill={colors.error} />
          <BloomText className="text-center text-[15px] font-semibold text-foreground">
            {t('search.widgets.savedSearches.loadError')}
          </BloomText>
          <Button
            variant="secondary"
            size="medium"
            onPress={() => queryClient.invalidateQueries({ queryKey: ['savedSearches'] })}
          >
            {t('search.widgets.common.error')}
          </Button>
        </StateBlock>
      );
    }

    if (searches.length === 0) {
      return (
        <StateBlock>
          <RiBookmarkLine width={ICON_SIZES.xl} height={ICON_SIZES.xl} fill={colors.textTertiary} />
          <View className="items-center gap-1">
            <BloomText className="text-center text-[15px] font-semibold text-foreground">
              {t('search.widgets.savedSearches.empty')}
            </BloomText>
            <BloomText className="text-center text-[13px] text-muted-foreground">
              {t('search.widgets.savedSearches.emptyHelper')}
            </BloomText>
          </View>
          <Button variant="primary" size="medium" onPress={() => router.push('/explore')}>
            {t('search.widgets.savedSearches.createNew')}
          </Button>
        </StateBlock>
      );
    }

    const remaining = searches.length - PREVIEW_COUNT;
    return (
      <View className="gap-3">
        <View>
          {searches.slice(0, PREVIEW_COUNT).map((item, index) => (
            <SavedSearchRow
              key={item.id ?? `${item.name}-${index}`}
              search={item}
              onPress={handleShowActions}
            />
          ))}
        </View>

        <View className="gap-2">
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

  const headerIcon = (
    <RiBookmarkFill width={HEADER_ICON_SIZE} height={HEADER_ICON_SIZE} fill={colors.primary} />
  );

  return (
    <>
      <BaseWidget title={t('search.widgets.savedSearches.title')} icon={headerIcon}>
        {renderState()}
      </BaseWidget>

      <Dialog
        open={!!editingSearch}
        onClose={handleEditClose}
        placement={{ base: 'bottom', md: 'center' }}
        maxWidth={400}
        title={t('search.widgets.savedSearches.editTitle')}
        label={t('search.widgets.savedSearches.editTitle')}
        actions={[
          {
            label: t('common.cancel'),
            color: 'cancel',
            onPress: handleEditClose,
            shouldCloseOnPress: false,
          },
          {
            label: t('common.save'),
            onPress: () => {
              void handleEditSave();
            },
            disabled: submitting,
            shouldCloseOnPress: false,
          },
        ]}
      >
        <View className="gap-4">
          <Field error={nameError || null}>
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
          </Field>

          <Field error={queryError || null}>
            <Textarea
              label={t('search.widgets.savedSearches.queryLabel')}
              placeholder={t('search.widgets.savedSearches.queryPlaceholder')}
              value={editQuery}
              onChangeText={(text) => {
                setEditQuery(text);
                if (queryError) setQueryError('');
              }}
              isInvalid={!!queryError}
              rows={2}
            />
          </Field>

          <Item
            density="compact"
            title={t('search.widgets.savedSearches.notificationsToggle')}
            subtitle={t('search.widgets.savedSearches.notificationsHelper')}
            trailing={
              <Switch
                value={editNotificationsEnabled}
                onValueChange={setEditNotificationsEnabled}
                accessibilityLabel={t('search.widgets.savedSearches.notificationsToggle')}
              />
            }
          />
        </View>
      </Dialog>
    </>
  );
}
