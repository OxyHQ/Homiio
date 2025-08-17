import React, { useMemo, useState } from 'react';
import { View, StyleSheet, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';

import { Header } from '@/components/Header';
import Button from '@/components/Button';
import { colors } from '@/styles/colors';
import savedPropertyFolderService from '@/services/savedPropertyFolderService';
import { toast } from 'sonner';

// Reuse the color palette from SaveToFolderBottomSheet
const FOLDER_COLORS = [
  '#3B82F6',
  '#EF4444',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#F97316',
  '#06B6D4',
  '#EC4899',
];

export default function EditFolderScreen() {
  const { t } = useTranslation();
  const { folderId } = useLocalSearchParams<{ folderId: string }>();
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();

  // Use React Query for folders data
  const { data: foldersData, isLoading: foldersLoading } = useQuery({
    queryKey: ['savedFolders'],
    queryFn: () => savedPropertyFolderService.getSavedPropertyFolders(oxyServices!, activeSessionId!),
    enabled: !!oxyServices && !!activeSessionId,
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 10,
  });

  const folders = foldersData?.folders || [];

  const folder = useMemo(() => folders.find((f: any) => f._id === folderId), [folders, folderId]);
  const [name, setName] = useState(folder?.name || '');
  const [emoji, setEmoji] = useState(folder?.icon || '📁');
  const [color, setColor] = useState(folder?.color || colors.primaryColor);

  // React Query mutation for updating folder
  const updateFolderMutation = useMutation({
    mutationFn: async (folderData: { name: string; icon: string; color: string }) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('Authentication required');
      }
      return savedPropertyFolderService.updateSavedPropertyFolder(
        folderId,
        folderData,
        oxyServices,
        activeSessionId
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savedFolders'] });
      toast.success('Folder updated successfully');
      router.back();
    },
    onError: (error: any) => {
      console.error('Failed to update folder:', error);
      toast.error('Failed to update folder');
    },
  });

  const handleSave = async () => {
    if (!folder) return;
    if (folder.isDefault) {
      Alert.alert('Not allowed', 'Default folder cannot be renamed.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Validation', 'Folder name is required');
      return;
    }

    updateFolderMutation.mutate({
      name: name.trim(),
      icon: emoji,
      color,
    });
  };

  if (!folder) {
    return (
      <View style={styles.container}>
        <Header options={{ title: t('saved.title'), showBackButton: true }} />
        <Text style={styles.infoText}>Folder not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header
        options={{
          title: `${emoji} ${folder.isDefault ? t('saved.defaultFolder', 'Default Folder') : t('saved.editFolder', 'Edit Folder')}`,
          showBackButton: true,
        }}
      />
      <View style={styles.form}>
        <Text style={styles.label}>{t('common.emoji', 'Emoji')}</Text>
        <TextInput value={emoji} onChangeText={setEmoji} style={styles.input} maxLength={2} />

        <Text style={styles.label}>{t('common.name', 'Name')}</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          style={[styles.input, folder.isDefault && { opacity: 0.6 }]}
          placeholder={t('saved.folderNamePlaceholder', 'Folder name')}
          editable={!folder.isDefault}
        />

        <Text style={styles.label}>{t('common.color', 'Color')}</Text>
        <View style={styles.colorGrid}>
          {FOLDER_COLORS.map((c) => {
            const isSelected = c === color;
            return (
              <TouchableOpacity
                key={c}
                style={StyleSheet.flatten([
                  styles.colorSwatch,
                  { backgroundColor: c },
                  isSelected && styles.colorSwatchSelected,
                  folder.isDefault && { opacity: 0.6 },
                ])}
                onPress={() => {
                  if (updateFolderMutation.isPending || folder.isDefault) return;
                  setColor(c);
                }}
              />
            );
          })}
        </View>

        <Button
          onPress={handleSave}
          style={updateFolderMutation.isPending ? { opacity: 0.6 } : undefined}
          disabled={updateFolderMutation.isPending}
        >
          {updateFolderMutation.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafbfc',
    paddingBottom: 40,
  },
  form: {
    padding: 16,
    gap: 12,
  },
  label: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  input: {
    backgroundColor: 'white',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#eaeaea',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorSwatchSelected: {
    borderColor: colors.primaryColor,
  },
  infoText: {
    padding: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
});
