/**
 * Save-to-folder sheet content, opened from `SaveButton`'s long press inside
 * the app's `BottomSheetContext` host.
 *
 * Bloom throughout: `Item` rows for the property preview and each folder,
 * `TextFieldInput` for the new folder's name, `Chip`s for the emoji choice,
 * `Button`s for every action and `toast` for outcomes. The colour swatches are
 * the one hand-drawn control — Bloom has no colour picker — and are exported
 * as `FolderColorSwatches` (with `FolderEmojiChips`) so the Saved screen's
 * "New folder" dialog and the folder edit screen draw the same ones.
 */
import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button, CloseButton } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { Field } from '@oxy.so/bloom/field';
import { RiAddLine, RiArrowRightSLine, RiCheckLine } from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { H3, Text as BloomText } from '@oxy.so/bloom/typography';
import type { Property } from '@homiio/shared-types';

import { spacing } from '@/constants/styles';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import savedPropertyFolderService, {
  type SavedPropertyFolder,
} from '@/services/savedPropertyFolderService';
import savedPropertyService from '@/services/savedPropertyService';
import { logger } from '@/utils/logger';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';

interface SaveToFolderBottomSheetProps {
  propertyId: string;
  propertyTitle: string;
  property?: Property;
  onClose: () => void;
  onSave: (folderId: string | null) => void;
}

/**
 * Curated folder-colour palette. These are user-selectable swatches (distinct
 * colour CHOICES), not semantic theme tokens, so they stay a fixed literal
 * palette independent of the Bloom theme.
 */
export const FOLDER_COLORS = [
  '#3B82F6', // Blue
  '#EF4444', // Red
  '#10B981', // Green
  '#F59E0B', // Yellow
  '#8B5CF6', // Purple
  '#F97316', // Orange
  '#06B6D4', // Cyan
  '#EC4899', // Pink
];

export const FOLDER_EMOJIS = ['📁', '🏠', '❤️', '⭐', '🔖', '📍', '🏢', '🎓'];

interface FolderEmojiChipsProps {
  value: string;
  onChange: (emoji: string) => void;
}

/** The folder emoji choice as a row of Bloom `Chip`s. */
export function FolderEmojiChips({ value, onChange }: FolderEmojiChipsProps) {
  return (
    <View style={styles.emojis}>
      {FOLDER_EMOJIS.map((emoji) => (
        <Chip
          key={emoji}
          size="large"
          variant={value === emoji ? 'subtle' : 'outlined'}
          color={value === emoji ? 'primary' : 'default'}
          selected={value === emoji}
          onPress={() => onChange(emoji)}
          accessibilityLabel={emoji}
        >
          {emoji}
        </Chip>
      ))}
    </View>
  );
}

interface FolderColorSwatchesProps {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}

/** A radio row of colour discs; the chosen one carries a check. */
export function FolderColorSwatches({ value, onChange, disabled }: FolderColorSwatchesProps) {
  const { colors: theme } = useTheme();
  return (
    <View style={styles.swatches} accessibilityRole="radiogroup">
      {FOLDER_COLORS.map((color) => {
        const selected = color === value;
        return (
          <Pressable
            key={color}
            onPress={() => onChange(color)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={color}
            style={[
              styles.swatch,
              { backgroundColor: color },
              selected && { borderColor: theme.text },
              disabled && styles.swatchDisabled,
            ]}
          >
            {selected ? <RiCheckLine width={16} height={16} fill="#FFFFFF" /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function SaveToFolderBottomSheet({
  propertyId,
  propertyTitle,
  property,
  onClose,
  onSave,
}: SaveToFolderBottomSheetProps) {
  const { t } = useTranslation();
  const { colors: theme } = useTheme();
  const { folders, isLoading, loadFolders } = useSavedPropertiesContext();
  const queryClient = useQueryClient();

  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedColor, setSelectedColor] = useState(FOLDER_COLORS[0]);
  const [selectedEmoji, setSelectedEmoji] = useState(FOLDER_EMOJIS[0]);

  const saveToFolderMutation = useMutation({
    mutationFn: async ({ folderId }: { folderId: string | null }) =>
      savedPropertyService.saveProperty(propertyId, undefined, folderId || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savedProperties'] });
      queryClient.invalidateQueries({ queryKey: ['savedFolders'] });
      toast.success(t('saved.toast.propertySavedToFolder'));
    },
    onError: (error: Error) => {
      logger.error('Failed to save to folder:', error);
      toast.error(t('saved.toast.saveToFolderFailed'));
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: async (folderData: { name: string; color: string; icon: string }) =>
      savedPropertyFolderService.createSavedPropertyFolder(folderData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savedFolders'] });
      toast.success(t('saved.toast.folderCreated'));
    },
    onError: (error: Error) => {
      logger.error('Failed to create folder:', error);
      toast.error(t('saved.toast.folderCreateFailed'));
    },
  });

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  const handleSaveToFolder = useCallback(
    async (folderId: string | null) => {
      try {
        await saveToFolderMutation.mutateAsync({ folderId });
        onSave(folderId);
        onClose();
      } catch {
        // Reported by the mutation's onError toast.
      }
    },
    [saveToFolderMutation, onSave, onClose],
  );

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) {
      toast.error(t('saved.folder.alertFolderNameRequired'));
      return;
    }
    try {
      const newFolder = await createFolderMutation.mutateAsync({
        name: newFolderName.trim(),
        color: selectedColor,
        icon: selectedEmoji,
      });
      if (newFolder) {
        await handleSaveToFolder(newFolder.id);
      }
    } catch {
      // Reported by the mutation's onError toast.
    }
  }, [newFolderName, selectedColor, selectedEmoji, createFolderMutation, handleSaveToFolder, t]);

  const renderFolderItem = (folder: SavedPropertyFolder) => (
    <Item
      key={folder.id}
      role="listitem"
      accessibilityRole="button"
      leading={
        <View style={[styles.folderDisc, { backgroundColor: folder.color }]}>
          <BloomText style={styles.folderEmoji}>{folder.icon}</BloomText>
        </View>
      }
      title={folder.name}
      subtitle={t('saved.folder.propertyCount', { count: folder.propertyCount })}
      trailing={<RiArrowRightSLine width={20} height={20} fill={theme.textTertiary} />}
      onPress={() => void handleSaveToFolder(folder.id)}
      disabled={isLoading || saveToFolderMutation.isPending}
    />
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <H3>{t('saved.folder.title')}</H3>
        <CloseButton accessibilityLabel={t('common.close')} onPress={onClose} size="sm" />
      </View>

      {property ? (
        <Item
          leading={
            <Image
              source={getPropertyImageSource(property)}
              style={styles.previewImage}
              resizeMode="cover"
            />
          }
          title={getPropertyTitle(property)}
          subtitle={
            property.address?.cityName
              ? `${property.address.cityName}${property.address.regionName ? `, ${property.address.regionName}` : ''}`
              : undefined
          }
        />
      ) : (
        <BloomText style={[styles.propertyTitle, { color: theme.textSecondary }]} numberOfLines={2}>
          {propertyTitle}
        </BloomText>
      )}

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator={false}>
        {showCreateFolder ? (
          <View style={styles.form}>
            <H3>{t('saved.folder.createNew')}</H3>

            <TextFieldInput
              label={t('saved.folder.folderNamePlaceholder')}
              value={newFolderName}
              onChangeText={setNewFolderName}
              maxLength={100}
              autoFocus
            />

            <Field label={t('saved.folder.chooseColor')}>
              <FolderColorSwatches value={selectedColor} onChange={setSelectedColor} />
            </Field>

            <Field label={t('saved.folder.chooseEmoji')}>
              <FolderEmojiChips value={selectedEmoji} onChange={setSelectedEmoji} />
            </Field>

            <View style={styles.formActions}>
              <Button variant="secondary" style={styles.flex} onPress={() => setShowCreateFolder(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                style={styles.flex}
                onPress={() => void handleCreateFolder()}
                loading={createFolderMutation.isPending}
                disabled={createFolderMutation.isPending || !newFolderName.trim()}
              >
                {t('saved.folder.createAndSave')}
              </Button>
            </View>
          </View>
        ) : (
          <>
            {folders.map(renderFolderItem)}
            <Button
              variant="secondary"
              leadingIcon={RiAddLine}
              onPress={() => setShowCreateFolder(true)}
              disabled={isLoading}
              style={styles.createButton}
            >
              {t('saved.folder.createNew')}
            </Button>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewImage: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  propertyTitle: {
    fontSize: 16,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    gap: spacing.xs,
  },
  folderDisc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderEmoji: {
    fontSize: 20,
  },
  createButton: {
    marginTop: spacing.md,
  },
  form: {
    gap: spacing.lg,
  },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchDisabled: {
    opacity: 0.6,
  },
  emojis: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  formActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  flex: {
    flex: 1,
  },
});

/**
 * Open this sheet for one property — the behaviour every "save somewhere
 * specific" entry point shares: `SaveButton`'s long press on a detail screen,
 * and a long press or right-click on a `PropertyCard` in a grid.
 *
 * An unsaved property is SAVED FIRST and the sheet opens after, so the heart
 * fills the moment the press lands rather than only once a folder is picked;
 * picking one then moves it. A save that fails is already reported by the
 * context's own toast, and the sheet still opens — the folder list is the
 * thing the press asked for.
 */
export function useOpenSaveToFolderSheet(): (
  property: Property,
  propertyId: string,
) => Promise<void> {
  const { openBottomSheet, closeBottomSheet } = useContext(BottomSheetContext);
  const { savePropertyToFolder, isPropertySaved } = useSavedPropertiesContext();

  return useCallback(
    async (property: Property, propertyId: string) => {
      if (!isPropertySaved(propertyId)) {
        await savePropertyToFolder(propertyId, null, property).catch(() => undefined);
      }
      openBottomSheet(
        <SaveToFolderBottomSheet
          propertyId={propertyId}
          propertyTitle={getPropertyTitle(property)}
          property={property}
          onClose={closeBottomSheet}
          // The sheet closes itself once a folder is chosen.
          onSave={() => undefined}
        />,
      );
    },
    [openBottomSheet, closeBottomSheet, savePropertyToFolder, isPropertySaved],
  );
}
