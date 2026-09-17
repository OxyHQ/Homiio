/**
 * Folders as Bloom `WishlistCard`s, with "New folder".
 *
 * A folder's cover is the photos of up to four homes actually saved in it, and
 * its line is its real count; an empty folder shows the card's neutral tile.
 * The folder's emoji leads its name, the one piece of identity `WishlistCard`
 * has room for (it takes no icon or tint).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { Dialog } from '@oxy.so/bloom/dialog';
import { Field } from '@oxy.so/bloom/field';
import { RiAddLine } from '@oxy.so/bloom/icons';
import { ListingCardGrid, WishlistCard } from '@oxy.so/bloom/listing-card';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';

import {
  FOLDER_COLORS,
  FOLDER_EMOJIS,
  FolderColorSwatches,
  FolderEmojiChips,
} from '@/components/SaveToFolderBottomSheet';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import type { SavedPropertyFolder } from '@/services/savedPropertyFolderService';
import type { SavedProperty } from '@/services/savedPropertyService';
import { getPropertyPhotoUrls } from '@/utils/propertyUtils';

import { SavedSection } from './SavedSection';

const COVER_PHOTOS = 4;

/** Two tiles a row on a phone, three on a tablet, four from a desktop column. */
const folderColumns = (width: number): number => (width < 640 ? 2 : width < 950 ? 3 : 4);

interface SavedFoldersSectionProps {
  folders: readonly SavedPropertyFolder[];
  savedProperties: readonly SavedProperty[];
  loading: boolean;
}

export function SavedFoldersSection({ folders, savedProperties, loading }: SavedFoldersSectionProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [creating, setCreating] = useState(false);

  const coversByFolder = useMemo(() => {
    const covers = new Map<string, string[]>();
    for (const property of savedProperties) {
      if (!property.folderId) continue;
      const list = covers.get(property.folderId) ?? [];
      if (list.length >= COVER_PHOTOS) continue;
      const cover = getPropertyPhotoUrls(property.images, property.coverImageIndex, 'small')[0];
      if (cover) list.push(cover);
      covers.set(property.folderId, list);
    }
    return covers;
  }, [savedProperties]);

  const onLayout = useCallback((event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width), []);
  const columns = folderColumns(width);

  let body: React.ReactNode;
  if (loading && folders.length === 0) {
    body = (
      <ListingCardGrid columns={columns} columnGap={16} rowGap={24}>
        {[0, 1].map((key) => (
          <Skeleton.Box key={key} width="100%" height={180} borderRadius={16} />
        ))}
      </ListingCardGrid>
    );
  } else if (folders.length === 0) {
    body = (
      <Text variant="body-2-regular" style={{ color: theme.colors.textSecondary }}>
        {t('saved.noFoldersDescription')}
      </Text>
    );
  } else {
    body = (
      <ListingCardGrid columns={columns} columnGap={16} rowGap={24}>
        {folders.map((folder) => (
          <WishlistCard
            key={folder.id}
            name={folder.icon ? `${folder.icon} ${folder.name}` : folder.name}
            description={t('saved.folder.propertyCount', { count: folder.propertyCount })}
            photos={coversByFolder.get(folder.id) ?? []}
            href={`/saved/${folder.id}`}
            onPress={() => router.push(`/saved/${folder.id}`)}
            accessibilityLabel={t('saved.openFolder', { name: folder.name })}
            testID={`saved-folder-${folder.id}`}
          />
        ))}
      </ListingCardGrid>
    );
  }

  return (
    <SavedSection
      title={t('saved.sections.folders')}
      action={
        <Button variant="secondary" size="small" leadingIcon={RiAddLine} onPress={() => setCreating(true)}>
          {t('saved.createFolder')}
        </Button>
      }
      testID="saved-folders"
    >
      <View onLayout={onLayout}>{body}</View>
      <CreateFolderDialog open={creating} onClose={() => setCreating(false)} />
    </SavedSection>
  );
}

function CreateFolderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { createFolder } = useSavedPropertiesContext();
  const [name, setName] = useState('');
  const [color, setColor] = useState(FOLDER_COLORS[0]);
  const [emoji, setEmoji] = useState(FOLDER_EMOJIS[0]);
  const [saving, setSaving] = useState(false);

  const close = useCallback(() => {
    setName('');
    setColor(FOLDER_COLORS[0]);
    setEmoji(FOLDER_EMOJIS[0]);
    onClose();
  }, [onClose]);

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t('saved.folder.alertFolderNameRequired'));
      return;
    }
    setSaving(true);
    try {
      // The context toasts success and failure.
      await createFolder({ name: trimmed, color, icon: emoji });
      close();
    } catch {
      // Already reported.
    } finally {
      setSaving(false);
    }
  }, [name, color, emoji, createFolder, close, t]);

  return (
    <Dialog
      open={open}
      onClose={close}
      placement={{ base: 'bottom', md: 'center' }}
      dismissOnBackdrop={!saving}
      maxWidth={440}
      title={t('saved.folder.createNew')}
      label={t('saved.folder.createNew')}
      actions={[
        {
          label: t('common.create'),
          disabled: saving || !name.trim(),
          shouldCloseOnPress: false,
          onPress: () => void submit(),
        },
        {
          label: t('common.cancel'),
          color: 'cancel',
          disabled: saving,
          shouldCloseOnPress: false,
          onPress: close,
        },
      ]}
    >
      <View style={{ gap: 16, paddingBottom: 8 }}>
        <TextFieldInput
          label={t('saved.folder.folderNamePlaceholder')}
          value={name}
          onChangeText={setName}
          maxLength={100}
          autoFocus
        />
        <Field label={t('saved.folder.chooseColor')}>
          <FolderColorSwatches value={color} onChange={setColor} disabled={saving} />
        </Field>
        <Field label={t('saved.folder.chooseEmoji')}>
          <FolderEmojiChips value={emoji} onChange={setEmoji} />
        </Field>
      </View>
    </Dialog>
  );
}
