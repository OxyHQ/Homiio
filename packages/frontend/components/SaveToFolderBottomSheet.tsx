import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Image,
} from 'react-native';
import { BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ThemedText } from './ThemedText';
import { colors } from '@/styles/colors';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import savedPropertyFolderService, { SavedPropertyFolder } from '@/services/savedPropertyFolderService';
import Button from './Button';
import { Property } from '@homiio/shared-types';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import savedPropertyService from '@/services/savedPropertyService';
import { toast } from 'sonner';

const IconComponent = Ionicons as any;

interface SaveToFolderBottomSheetProps {
  propertyId: string;
  propertyTitle: string;
  property?: Property;
  onClose: () => void;
  onSave: (folderId: string | null) => void;
}

const FOLDER_COLORS = [
  '#3B82F6', // Blue
  '#EF4444', // Red
  '#10B981', // Green
  '#F59E0B', // Yellow
  '#8B5CF6', // Purple
  '#F97316', // Orange
  '#06B6D4', // Cyan
  '#EC4899', // Pink
];

const FOLDER_EMOJIS = ['📁', '🏠', '❤️', '⭐', '🔖', '📍', '🏢', '🎓'];

export function SaveToFolderBottomSheet({
  propertyId,
  propertyTitle,
  property,
  onClose,
  onSave,
}: SaveToFolderBottomSheetProps) {
  const { t: _t } = useTranslation();
  const { folders, isLoading, loadFolders } = useSavedPropertiesContext();
  const queryClient = useQueryClient();

  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedColor, setSelectedColor] = useState(FOLDER_COLORS[0]);
  const [selectedEmoji, setSelectedEmoji] = useState(FOLDER_EMOJIS[0]);

  // React Query mutations
  const saveToFolderMutation = useMutation({
    mutationFn: async ({ propertyId, folderId }: { propertyId: string; folderId: string | null }) => {
      return savedPropertyService.saveProperty(propertyId, undefined, folderId || undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savedProperties'] });
      queryClient.invalidateQueries({ queryKey: ['savedFolders'] });
      toast.success('Property saved to folder');
    },
    onError: (error: any) => {
      console.error('Failed to save to folder:', error);
      toast.error('Failed to save to folder');
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: async (folderData: { name: string; color: string; icon: string }) => {
      return savedPropertyFolderService.createSavedPropertyFolder(folderData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savedFolders'] });
      toast.success('Folder created successfully');
    },
    onError: (error: any) => {
      console.error('Failed to create folder:', error);
      toast.error('Failed to create folder');
    },
  });

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  const handleSaveToFolder = useCallback(
    async (folderId: string | null) => {
      try {
        await saveToFolderMutation.mutateAsync({ propertyId, folderId });
        onSave(folderId);
        onClose();
      } catch (error) {
        console.error('Failed to save to folder:', error);
      }
    },
    [propertyId, saveToFolderMutation, onSave, onClose],
  );

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) {
      Alert.alert('Error', 'Please enter a folder name');
      return;
    }

    try {
      const newFolder = await createFolderMutation.mutateAsync({
        name: newFolderName.trim(),
        color: selectedColor,
        icon: selectedEmoji,
      });

      // Save property to the new folder
      if (newFolder) {
        await handleSaveToFolder(newFolder._id);
      }
    } catch (error) {
      console.error('Failed to create folder:', error);
    }
  }, [newFolderName, selectedColor, selectedEmoji, createFolderMutation, handleSaveToFolder]);

  const renderFolderItem = (folder: SavedPropertyFolder) => (
    <TouchableOpacity
      key={folder._id}
      style={styles.folderItem}
      onPress={() => handleSaveToFolder(folder._id)}
      disabled={isLoading || saveToFolderMutation.isPending}
    >
      <View style={[styles.folderIcon, { backgroundColor: folder.color }]}>
        <Text style={styles.folderEmojiText}>{folder.icon}</Text>
      </View>
      <View style={styles.folderInfo}>
        <ThemedText style={styles.folderName}>{folder.name}</ThemedText>
        <ThemedText style={styles.folderCount}>
          {folder.propertyCount} {folder.propertyCount === 1 ? 'property' : 'properties'}
        </ThemedText>
      </View>
      <IconComponent name="chevron-forward" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
    </TouchableOpacity>
  );

  const renderCreateFolderForm = () => (
    <View style={styles.createFolderForm}>
      <ThemedText style={styles.sectionTitle}>Create New Folder</ThemedText>

      <TextInput
        style={styles.input}
        placeholder="Folder name"
        value={newFolderName}
        onChangeText={setNewFolderName}
        maxLength={100}
      />

      <ThemedText style={styles.sectionTitle}>Choose Color</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.colorPicker}>
        {FOLDER_COLORS.map((color) => (
          <TouchableOpacity
            key={color}
            style={[
              styles.colorOption,
              { backgroundColor: color },
              selectedColor === color && styles.selectedColor,
            ]}
            onPress={() => setSelectedColor(color)}
          >
            {selectedColor === color && <IconComponent name="checkmark" size={16} color="white" />}
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ThemedText style={styles.sectionTitle}>Choose Emoji</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.iconPicker}>
        {FOLDER_EMOJIS.map((emoji) => (
          <TouchableOpacity
            key={emoji}
            style={[styles.iconOption, selectedEmoji === emoji && styles.selectedIcon]}
            onPress={() => setSelectedEmoji(emoji)}
          >
            <Text style={[styles.emojiText, selectedEmoji === emoji && styles.selectedEmojiText]}>
              {emoji}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.createFolderActions}>
        <TouchableOpacity onPress={() => setShowCreateFolder(false)} style={styles.cancelButton}>
          <ThemedText style={styles.cancelButtonText}>Cancel</ThemedText>
        </TouchableOpacity>
        <Button
          onPress={handleCreateFolder}
          disabled={createFolderMutation.isPending || !newFolderName.trim()}
          style={styles.createButton}
        >
          {createFolderMutation.isPending ? 'Creating...' : 'Create & Save'}
        </Button>
      </View>
    </View>
  );

  return (
    <BottomSheetView style={styles.container}>
      <View style={styles.header}>
        <ThemedText style={styles.title}>Save to Folder</ThemedText>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <IconComponent name="close" size={24} color={colors.COLOR_BLACK_LIGHT_4} />
        </TouchableOpacity>
      </View>

      {property ? (
        <View style={styles.propertyPreview}>
          <Image
            source={getPropertyImageSource(property)}
            style={styles.previewImage}
            resizeMode="cover"
          />
          <View style={styles.previewTexts}>
            <ThemedText style={styles.previewTitle} numberOfLines={1}>
              {getPropertyTitle(property)}
            </ThemedText>
            {!!property.address?.city && (
              <ThemedText style={styles.previewSubtitle} numberOfLines={1}>
                {property.address.city}{property.address?.state ? `, ${property.address.state}` : ''}
              </ThemedText>
            )}
          </View>
        </View>
      ) : (
        <ThemedText style={styles.propertyTitle} numberOfLines={2}>
          {propertyTitle}
        </ThemedText>
      )}

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {showCreateFolder ? (
          renderCreateFolderForm()
        ) : (
          <>
            {folders.map(renderFolderItem)}

            <TouchableOpacity
              style={styles.createFolderButton}
              onPress={() => setShowCreateFolder(true)}
              disabled={isLoading}
            >
              <IconComponent name="add-circle-outline" size={24} color={colors.primaryColor} />
              <ThemedText style={styles.createFolderText}>Create New Folder</ThemedText>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </BottomSheetView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  propertyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  previewImage: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  previewTexts: {
    flex: 1,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  previewSubtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  propertyTitle: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_2,
    marginBottom: 20,
  },
  content: {
    flex: 1,
  },
  folderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
    marginBottom: 8,
  },
  folderIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  folderInfo: {
    flex: 1,
  },
  folderName: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 2,
  },
  folderCount: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  createFolderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.primaryColor,
    borderStyle: 'dashed',
    marginTop: 16,
  },
  createFolderText: {
    fontSize: 16,
    color: colors.primaryColor,
    marginLeft: 12,
    fontWeight: '500',
  },
  createFolderForm: {
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
  },
  colorPicker: {
    marginBottom: 16,
  },
  colorOption: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedColor: {
    borderWidth: 3,
    borderColor: colors.primaryColor,
  },
  iconPicker: {
    marginBottom: 16,
  },
  iconOption: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
  },
  selectedIcon: {
    backgroundColor: colors.primaryLight,
  },
  emojiText: {
    fontSize: 24,
  },
  selectedEmojiText: {
    opacity: 0.7,
  },
  folderEmojiText: {
    fontSize: 20,
    color: 'white',
  },
  createFolderActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cancelButtonText: {
    color: colors.COLOR_BLACK_LIGHT_2,
    fontSize: 16,
    fontWeight: '600',
  },
  createButton: {
    flex: 1,
  },
  propertyCardContainer: {
    marginBottom: 20,
  },
});
