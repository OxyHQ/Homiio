import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services';

import { Button } from '@oxy.so/bloom/button';
import { Field } from '@oxy.so/bloom/field';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { toast } from '@oxy.so/bloom/toast';

import { Header } from '@/components/Header';
import { FolderColorSwatches, FOLDER_COLORS } from '@/components/SaveToFolderBottomSheet';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { contentClamp, spacing } from '@/constants/styles';
import savedPropertyFolderService, {
  type SavedPropertyFolder,
} from '@/services/savedPropertyFolderService';
import { logger } from '@/utils/logger';

export default function EditFolderScreen() {
  const { t } = useTranslation();
  const { folderId } = useLocalSearchParams<{ folderId: string }>();
  const { oxyServices, activeSessionId } = useOxy();

  const { data: foldersData, isLoading } = useQuery({
    queryKey: ['savedFolders'],
    queryFn: () => savedPropertyFolderService.getSavedPropertyFolders(),
    enabled: !!oxyServices && !!activeSessionId,
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 10,
  });

  const folder = useMemo(
    () => (foldersData?.folders ?? []).find((f) => f.id === folderId),
    [foldersData?.folders, folderId],
  );

  if (!folder) {
    return (
      <View style={styles.container}>
        <Header options={{ title: t('saved.title'), showBackButton: true }} />
        {isLoading ? (
          <View style={styles.form}>
            <ListSkeleton rows={3} rowHeight={56} />
          </View>
        ) : (
          <EmptyState
            icon="folder-open-outline"
            title={t('saved.noFolder')}
            description={t('saved.noFolderDescription')}
          />
        )}
      </View>
    );
  }

  // Keyed on the folder so the form state seeds from the loaded folder rather
  // than from the empty first render before the query resolved.
  return <EditFolderForm key={folder.id} folder={folder} />;
}

function EditFolderForm({ folder }: { folder: SavedPropertyFolder }) {
  const { t } = useTranslation();
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();

  const [name, setName] = useState(folder.name || '');
  const [emoji, setEmoji] = useState(folder.icon || '📁');
  const [color, setColor] = useState(folder.color || FOLDER_COLORS[0]);

  const updateFolderMutation = useMutation({
    mutationFn: async (folderData: { name: string; icon: string; color: string }) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('Authentication required');
      }
      return savedPropertyFolderService.updateSavedPropertyFolder(folder.id, folderData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savedFolders'] });
      toast.success(t('saved.toast.folderUpdated'));
      router.back();
    },
    onError: (error: unknown) => {
      logger.error('Failed to update folder:', error);
      toast.error(t('saved.toast.folderUpdateFailed'));
    },
  });

  const locked = folder.isDefault || updateFolderMutation.isPending;

  const handleSave = () => {
    if (folder.isDefault) {
      toast.error(t('saved.folder.alertDefaultFolderRename'));
      return;
    }
    if (!name.trim()) {
      toast.error(t('saved.folder.alertFolderNameRequired'));
      return;
    }
    updateFolderMutation.mutate({ name: name.trim(), icon: emoji, color });
  };

  return (
    <View style={styles.container}>
      <Header
        options={{
          title: `${emoji} ${folder.isDefault ? t('saved.defaultFolder') : t('saved.editFolder')}`,
          showBackButton: true,
        }}
      />
      <View style={styles.form}>
        <Field label={t('common.emoji')}>
          <TextFieldInput
            label={t('common.emoji')}
            value={emoji}
            onChangeText={setEmoji}
            maxLength={2}
          />
        </Field>

        <Field label={t('common.name')} disabled={folder.isDefault}>
          <TextFieldInput
            label={t('common.name')}
            value={name}
            onChangeText={setName}
            placeholder={t('saved.folderNamePlaceholder')}
            disabled={folder.isDefault}
          />
        </Field>

        <Field label={t('common.color')} disabled={folder.isDefault}>
          <FolderColorSwatches value={color} onChange={setColor} disabled={locked} />
        </Field>

        <Button
          onPress={handleSave}
          size="large"
          loading={updateFolderMutation.isPending}
          disabled={updateFolderMutation.isPending}
        >
          {t('common.save')}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingBottom: spacing['3xl'],
  },
  form: {
    width: '100%',
    maxWidth: contentClamp.copy,
    alignSelf: 'center',
    padding: spacing.lg,
    gap: spacing.lg,
  },
});
