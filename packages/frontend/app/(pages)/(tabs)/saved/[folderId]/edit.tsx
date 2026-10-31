import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { Button } from '@oxy.so/bloom/button';
import { Field } from '@oxy.so/bloom/field';
import { RiDeleteBinLine } from '@oxy.so/bloom/icons/RiDeleteBinLine';
import { RiFolderOpenLine } from '@oxy.so/bloom/icons/RiFolderOpenLine';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { confirm } from '@oxy.so/bloom/surfaces';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { toast } from '@oxy.so/bloom/toast';

import { FolderColorSwatches, FOLDER_COLORS } from '@/components/SaveToFolderBottomSheet';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { contentClamp, spacing } from '@/constants/styles';
import type { SavedPropertyFolder } from '@/services/savedPropertyFolderService';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { accountOwnerKey, useAccountOwner, useAccountOwnerGuard } from '@/hooks/useAccountOwner';
import { useSavedFoldersQuery } from '@/hooks/useSavedQueries';
import { logger } from '@/utils/logger';

export default function EditFolderScreen() {
  const { t } = useTranslation();
  const { folderId } = useLocalSearchParams<{ folderId: string }>();
  const owner = useAccountOwner();
  const { data: foldersData, isLoading } = useSavedFoldersQuery();

  const folder = useMemo(
    () => (foldersData?.folders ?? []).find((f) => f.id === folderId),
    [foldersData?.folders, folderId],
  );

  if (!folder) {
    return (
      <Screen
        documentScroll
        header={
          <PageHeader
            title={t('saved.title')}
            titleAlign="center"
            leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
            onBack={router.canGoBack() ? router.back : undefined}
            backLabel={t('goBack')}
          />
        }
      >
        <ScreenScrollView>
          {isLoading ? (
            <View style={styles.form}>
              <ListSkeleton rows={3} rowHeight={56} />
            </View>
          ) : (
            <EmptyState
              icon={RiFolderOpenLine}
              title={t('saved.noFolder')}
              description={t('saved.noFolderDescription')}
            />
          )}
        </ScreenScrollView>
      </Screen>
    );
  }

  // Keyed on the folder so the form state seeds from the loaded folder rather
  // than from the empty first render before the query resolved.
  return (
    <EditFolderForm key={JSON.stringify([...accountOwnerKey(owner), folder.id])} folder={folder} />
  );
}

function EditFolderForm({ folder }: { folder: SavedPropertyFolder }) {
  const { t } = useTranslation();
  const { owner, isCurrent } = useAccountOwnerGuard();

  const [name, setName] = useState(folder.name || '');
  const [emoji, setEmoji] = useState(folder.icon || '📁');
  const [color, setColor] = useState(folder.color || FOLDER_COLORS[0]);

  const { deleteFolder, updateFolder, loadSavedProperties } = useSavedPropertiesContext();
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);

  const locked = folder.isDefault || saving || deleting;

  const handleDelete = async () => {
    const captured = owner;
    if (!isCurrent(captured)) return;
    const ok = await confirm({
      title: t('saved.folders.deleteTitle'),
      description: t('saved.folders.deleteMessage', { name: folder.name }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok || !isCurrent(captured)) return;
    setDeleting(true);
    try {
      // The context toasts the outcome. The homes filed here stay saved — the
      // server clears their folder — so the saved list is refetched too.
      await deleteFolder(folder.id);
      if (!isCurrent(captured)) return;
      void loadSavedProperties();
      router.replace('/saved');
    } catch (error: unknown) {
      logger.error('Failed to delete folder:', error);
    } finally {
      if (isCurrent(captured)) setDeleting(false);
    }
  };

  const handleSave = async () => {
    const captured = owner;
    if (!isCurrent(captured)) return;
    if (folder.isDefault) {
      toast.error(t('saved.folder.alertDefaultFolderRename'));
      return;
    }
    if (!name.trim()) {
      toast.error(t('saved.folder.alertFolderNameRequired'));
      return;
    }
    setSaving(true);
    try {
      await updateFolder(folder.id, { name: name.trim(), icon: emoji, color });
      if (isCurrent(captured)) router.back();
    } catch (error) {
      if (isCurrent(captured)) logger.error('Failed to update folder:', error);
    } finally {
      if (isCurrent(captured)) setSaving(false);
    }
  };

  return (
    <Screen
      documentScroll
      header={
        <PageHeader
          title={`${emoji} ${folder.isDefault ? t('saved.defaultFolder') : t('saved.editFolder')}`}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          onBack={router.canGoBack() ? router.back : undefined}
          backLabel={t('goBack')}
        />
      }
    >
      <ScreenScrollView contentContainerStyle={styles.form}>
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
          onPress={() => void handleSave()}
          size="lg"
          loading={saving}
          disabled={saving || deleting}
        >
          {t('common.save')}
        </Button>

        {folder.isDefault ? null : (
          <Button
            size="lg"
            leadingIcon={RiDeleteBinLine}
            onPress={() => void handleDelete()}
            loading={deleting}
            disabled={locked}
            tone="danger"
            appearance="solid"
          >
            {t('saved.folders.deleteTitle')}
          </Button>
        )}
      </ScreenScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: {
    width: '100%',
    maxWidth: contentClamp.copy,
    alignSelf: 'center',
    padding: spacing.lg,
    gap: spacing.lg,
  },
});
