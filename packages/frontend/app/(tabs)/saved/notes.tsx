/**
 * Saved → Notes: every note on every saved property, newest (and pinned)
 * first, filterable by All / Active / Pinned / Archived.
 *
 * Bloom throughout: `Tabs` for the filter strip, a `Card` per note with the
 * property as an `Item`, icon-only `Button`s for pin / archive / delete, a
 * controlled `Dialog` holding a `Textarea` for editing, `confirm()` before a
 * delete and `toast` for the outcome.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { Dialog } from '@oxy.so/bloom/dialog';
import {
  RiArchiveLine,
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiPushpinFill,
  RiPushpinLine,
} from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { confirm } from '@oxy.so/bloom/surfaces';
import { Tabs, TabsTrigger } from '@oxy.so/bloom/tabs';
import { Textarea } from '@oxy.so/bloom/textarea';
import { useTheme } from '@oxy.so/bloom/theme';
import { toast } from '@oxy.so/bloom/toast';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { spacing } from '@/constants/styles';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { useSavedNotesMutation } from '@/hooks/useSavedNotes';
import { logger } from '@/utils/logger';
import {
  deleteNote,
  parseNotesString,
  serializeNotesArray,
  toggleArchive,
  togglePin,
  upsertNote,
  type PropertyNote,
} from '@/utils/notes';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';

type NotesFilter = 'all' | 'active' | 'pinned' | 'archived';

interface FlatNote {
  propertyId: string;
  note: PropertyNote;
  title: string;
  image: ImageSourcePropType;
  meta: string;
}

export default function NotesScreen() {
  const { t } = useTranslation();
  const { savedProperties, loadSavedProperties } = useSavedPropertiesContext();
  const { mutateAsync: updateNotesMutate } = useSavedNotesMutation();

  const flatNotes = useMemo<FlatNote[]>(() => {
    const out: FlatNote[] = [];
    savedProperties.forEach((p) => {
      const propertyId = p.id as string;
      const title = getPropertyTitle(p) || p.address?.cityName || 'Property';
      const image = getPropertyImageSource(p);
      // Headline price for the note card: monthly when present, else the
      // nightly rate for vacation-only listings.
      const price = p.longTermRent?.monthlyAmount ?? p.shortTermRent?.nightlyRate;
      const currency = p.longTermRent?.currency ?? p.shortTermRent?.currency;
      const location = [p.address?.cityName, p.address?.regionName].filter(Boolean).join(', ');
      const meta = [
        price ? `${price}${currency ? ` ${currency}` : ''}` : '',
        p.bedrooms ? `${p.bedrooms} bd` : '',
        p.bathrooms ? `${p.bathrooms} ba` : '',
        location,
      ]
        .filter(Boolean)
        .join(' • ');
      parseNotesString(p.notes).forEach((note) => out.push({ propertyId, note, title, image, meta }));
    });
    return out;
  }, [savedProperties]);

  const [filter, setFilter] = useState<NotesFilter>('all');
  const [editing, setEditing] = useState<{ propertyId: string; note: PropertyNote } | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const visibleNotes = useMemo(
    () =>
      flatNotes
        .filter(({ note }) => {
          if (filter === 'archived') return !!note.isArchived;
          if (filter === 'pinned') return !!note.isPinned && !note.isArchived;
          if (filter === 'active') return !note.isArchived;
          return true;
        })
        .sort((a, b) => {
          const pinDiff = Number(!!b.note.isPinned) - Number(!!a.note.isPinned);
          if (pinDiff !== 0) return pinDiff;
          const ad = Date.parse(a.note.updatedAt || a.note.createdAt);
          const bd = Date.parse(b.note.updatedAt || b.note.createdAt);
          return bd - ad;
        }),
    [flatNotes, filter],
  );

  const persistNotes = useCallback(
    async (propertyId: string, mutator: (notes: PropertyNote[]) => PropertyNote[]) => {
      const property = savedProperties.find((p) => p.id === propertyId);
      if (!property) return;
      const updated = mutator(parseNotesString(property.notes));
      await updateNotesMutate({ propertyId, notes: serializeNotesArray(updated) });
      await loadSavedProperties();
    },
    [savedProperties, updateNotesMutate, loadSavedProperties],
  );

  const closeEditor = useCallback(() => {
    setEditing(null);
    setText('');
  }, []);

  const handleSaveNote = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await persistNotes(editing.propertyId, (notes) =>
        upsertNote(notes, { id: editing.note.id, text }),
      );
      closeEditor();
      toast.success(t('saved.notes.saved'));
    } catch (error: unknown) {
      logger.error('Failed to save note:', error);
      toast.error(t('saved.errors.updateNotesFailed'));
    } finally {
      setSaving(false);
    }
  }, [editing, text, persistNotes, closeEditor, t]);

  const handleDeleteNote = useCallback(
    async (propertyId: string, noteId: string) => {
      const ok = await confirm({
        title: t('saved.notes.deleteTitle'),
        description: t('saved.notes.deleteMessage'),
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      });
      if (!ok) return;
      try {
        await persistNotes(propertyId, (notes) => deleteNote(notes, noteId));
        toast.success(t('saved.notes.deleted'));
      } catch (error: unknown) {
        logger.error('Failed to delete note:', error);
        toast.error(t('saved.errors.updateNotesFailed'));
      }
    },
    [persistNotes, t],
  );

  const handleToggle = useCallback(
    async (propertyId: string, noteId: string, kind: 'pin' | 'archive') => {
      try {
        await persistNotes(propertyId, (notes) =>
          kind === 'pin' ? togglePin(notes, noteId) : toggleArchive(notes, noteId),
        );
      } catch (error: unknown) {
        logger.error(`Failed to toggle note ${kind}:`, error);
        toast.error(t('saved.errors.updateNotesFailed'));
      }
    },
    [persistNotes, t],
  );

  return (
    <View style={styles.container}>
      <Header options={{ title: t('saved.notes.title'), showBackButton: true }} />
      <View style={styles.tabs}>
        <Tabs value={filter} onValueChange={(next) => setFilter(next as NotesFilter)}>
          <TabsTrigger value="all" label={t('common.all')} />
          <TabsTrigger value="active" label={t('saved.notes.filters.active')} />
          <TabsTrigger value="pinned" label={t('saved.notes.filters.pinned')} />
          <TabsTrigger value="archived" label={t('saved.notes.filters.archived')} />
        </Tabs>
      </View>
      <FlatList
        data={visibleNotes}
        keyExtractor={(item) => `${item.propertyId}-${item.note.id}`}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          <EmptyState
            icon="document-text-outline"
            title={t('saved.notes.emptyTitle')}
            description={t('saved.notes.emptyDescription')}
          />
        }
        renderItem={({ item }) => (
          <NoteCard
            item={item}
            onEdit={() => {
              setEditing({ propertyId: item.propertyId, note: item.note });
              setText(item.note.text);
            }}
            onTogglePin={() => void handleToggle(item.propertyId, item.note.id, 'pin')}
            onToggleArchive={() => void handleToggle(item.propertyId, item.note.id, 'archive')}
            onDelete={() => void handleDeleteNote(item.propertyId, item.note.id)}
          />
        )}
      />

      <Dialog
        placement="center"
        open={editing !== null}
        onClose={closeEditor}
        dismissOnBackdrop={!saving}
        maxWidth={480}
        title={t('saved.actions.editNotes')}
        label={t('saved.actions.editNotes')}
        actions={[
          {
            label: t('common.save'),
            disabled: saving || !text.trim(),
            shouldCloseOnPress: false,
            onPress: () => void handleSaveNote(),
          },
          {
            label: t('common.cancel'),
            color: 'cancel',
            disabled: saving,
            shouldCloseOnPress: false,
            onPress: closeEditor,
          },
        ]}
      >
        <Textarea
          label={t('saved.notes.title')}
          value={text}
          onChangeText={setText}
          placeholder={t('saved.notes.placeholder')}
          rows={5}
          autoResize
          editable={!saving}
        />
      </Dialog>
    </View>
  );
}

interface NoteCardProps {
  item: FlatNote;
  onEdit: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}

function NoteCard({ item, onEdit, onTogglePin, onToggleArchive, onDelete }: NoteCardProps) {
  const { t } = useTranslation();
  const { colors: theme } = useTheme();
  const { note } = item;

  return (
    <Card
      variant="outlined"
      radius="radius-16"
      onPress={onEdit}
      accessibilityRole="button"
      accessibilityLabel={`${t('saved.actions.editNotes')}: ${item.title}`}
      style={[
        styles.noteCard,
        note.isArchived && styles.archived,
        note.color ? { backgroundColor: note.color, borderColor: 'transparent' } : null,
      ]}
    >
      <BloomText style={styles.noteText} numberOfLines={6}>
        {note.text}
      </BloomText>
      <Item
        density="compact"
        role="listitem"
        leading={<Image source={item.image} style={styles.previewImage} />}
        title={item.title}
        subtitle={item.meta || undefined}
        trailing={<RiArrowRightSLine width={16} height={16} fill={theme.textTertiary} />}
        onPress={() => router.push(`/properties/${item.propertyId}`)}
        accessibilityRole="link"
        style={styles.preview}
      />
      <View style={styles.actions}>
        <Button
          variant="ghost"
          size="small"
          iconOnly
          leadingIcon={note.isPinned ? RiPushpinFill : RiPushpinLine}
          accessibilityLabel={note.isPinned ? t('saved.notes.unpin') : t('saved.notes.pin')}
          onPress={onTogglePin}
        />
        <Button
          variant="ghost"
          size="small"
          iconOnly
          leadingIcon={RiArchiveLine}
          accessibilityLabel={note.isArchived ? t('saved.notes.unarchive') : t('saved.notes.archive')}
          onPress={onToggleArchive}
        />
        <Button
          variant="ghost"
          size="small"
          iconOnly
          leadingIcon={RiDeleteBinLine}
          accessibilityLabel={t('common.delete')}
          onPress={onDelete}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabs: {
    paddingHorizontal: spacing.lg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing['6xl'],
    gap: spacing.md,
    flexGrow: 1,
  },
  gridRow: {
    gap: spacing.md,
  },
  noteCard: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  archived: {
    opacity: 0.6,
  },
  noteText: {
    fontSize: 14,
    lineHeight: 20,
  },
  preview: {
    paddingHorizontal: 0,
  },
  previewImage: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
});
