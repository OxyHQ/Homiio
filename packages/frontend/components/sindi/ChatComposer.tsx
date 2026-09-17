import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AgentThinking } from '@oxy.so/bloom/agent-thinking';
import { Button } from '@oxy.so/bloom/button';
import {
  ComposerPanel,
  type ComposerPanelAddMenuGroup,
  type ComposerPanelAttachment,
  type ComposerPanelAttachmentKind,
  type ComposerPanelLabels,
} from '@oxy.so/bloom/composer-panel';
import { RiAttachment2, RiStopFill } from '@oxy.so/bloom/icons';
import { useVoiceDraft } from '@/hooks/voice/useVoiceDraft';

const MAX_MESSAGE_LENGTH = 1000;

/** The add menu's one row. */
const ATTACH_FILE_ROW = 'attach-file';

/** Attached document preview (subset of the `DocumentPicker` asset we display). */
export interface AttachedFilePreview {
  uri: string;
  name?: string;
  mimeType?: string;
}

export interface ChatComposerProps {
  input: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onAttachFile: () => void;
  onRemoveFile: () => void;
  attachedFile: AttachedFilePreview | null;
  /** A reply is streaming. */
  isLoading: boolean;
  /** An attached file is being uploaded / analysed. */
  isUploading: boolean;
  /** The composer cannot send (consent pending). */
  disabled: boolean;
  /** Whether the streaming reply has produced visible text yet. */
  hasStreamedText: boolean;
}

const EXTENSION_KINDS: Record<string, ComposerPanelAttachmentKind> = {
  csv: 'spreadsheet',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  ods: 'spreadsheet',
  numbers: 'spreadsheet',
  ppt: 'presentation',
  pptx: 'presentation',
  odp: 'presentation',
  key: 'presentation',
};

/** The tile glyph for a picked file: its MIME family first, then its extension. */
function attachmentKind(file: AttachedFilePreview): ComposerPanelAttachmentKind {
  const mime = file.mimeType ?? '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  const extension = file.name?.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_KINDS[extension] ?? 'document';
}

/**
 * The Sindi composer: Bloom's `ComposerPanel` — a multi-line prompt (Enter
 * sends on web, Shift+Enter breaks the line), an add menu whose one row opens
 * the file picker, the picked file as an attachment tile, real voice dictation
 * on the mic, and send. Permission modes and the model picker are Bloom
 * defaults that do not apply to Sindi and are hidden (`permissions={[]}`, no
 * `providers`).
 *
 * `ComposerPanel` has no stop control, so while a reply streams a Stop button
 * sits on the status row above it, beside `AgentThinking`.
 *
 * Bloom owns only interaction state. Sending, streaming, uploading and the
 * file-credit gate stay in `useSindiConversation`.
 */
export const ChatComposer = React.memo<ChatComposerProps>(
  ({
    input,
    onChangeText,
    onSubmit,
    onStop,
    onAttachFile,
    onRemoveFile,
    attachedFile,
    isLoading,
    isUploading,
    disabled,
    hasStreamedText,
  }) => {
    const { t } = useTranslation();

    const handleChange = useCallback(
      (text: string) => onChangeText(text.slice(0, MAX_MESSAGE_LENGTH)),
      [onChangeText],
    );

    const { listening, setListening, cancel: cancelVoice } = useVoiceDraft({
      value: input,
      onChange: handleChange,
    });

    const labels = useMemo<ComposerPanelLabels>(
      () => ({
        message: t('sindi.chat.field'),
        add: t('sindi.chat.addMenu'),
        addMenu: t('sindi.chat.addMenu'),
        voice: t('sindi.chat.voice'),
        send: t('sindi.chat.send'),
        remove: t('sindi.chat.removeAttachment'),
      }),
      [t],
    );

    const addMenu = useMemo<ComposerPanelAddMenuGroup[]>(
      () => [
        {
          label: t('sindi.chat.addGroup'),
          rows: [{ id: ATTACH_FILE_ROW, label: t('sindi.chat.attach'), icon: RiAttachment2 }],
        },
      ],
      [t],
    );

    const onAddMenuSelect = useCallback(
      (rowId: string) => {
        if (rowId === ATTACH_FILE_ROW) onAttachFile();
      },
      [onAttachFile],
    );

    // No byte-level upload progress exists (the web path embeds the file in the
    // message, the native path is one POST), so the tile is always shown landed
    // rather than drawing an invented ring.
    const attachments = useMemo<ComposerPanelAttachment[] | undefined>(() => {
      if (!attachedFile) return undefined;
      const kind = attachmentKind(attachedFile);
      return [
        {
          id: attachedFile.uri,
          name: attachedFile.name ?? t('sindi.chat.attach'),
          kind,
          src: kind === 'image' ? attachedFile.uri : undefined,
        },
      ];
    }, [attachedFile, t]);

    const onRemoveAttachment = useCallback(() => {
      if (!isUploading) onRemoveFile();
    }, [isUploading, onRemoveFile]);

    const hasContent = Boolean(input.trim() || attachedFile);
    const busy = isLoading || isUploading;

    const handleSubmit = useCallback(() => {
      // Enter reaches here too; the hook's own guards stay the authority, this
      // only refuses the obvious no-ops.
      if (!hasContent || busy || disabled) return;
      cancelVoice();
      onSubmit();
    }, [hasContent, busy, disabled, cancelVoice, onSubmit]);

    const handleStop = useCallback(() => {
      cancelVoice();
      onStop();
    }, [cancelVoice, onStop]);

    // Reasoning streams nothing visible first, so the indicator stays up until
    // a word exists; an upload has no stream at all.
    const thinking = isUploading || (isLoading && !hasStreamedText);

    return (
      <View style={styles.footer}>
        {thinking || isLoading ? (
          <View style={styles.statusRow}>
            <View style={styles.statusLead}>
              {thinking ? (
                <AgentThinking variant="infinity" label={t('sindi.status.thinking')} />
              ) : null}
            </View>
            {isLoading ? (
              <Button
                variant="secondary"
                size="small"
                leadingIcon={RiStopFill}
                onPress={handleStop}
                accessibilityLabel={t('sindi.chat.stop')}
              >
                {t('sindi.chat.stop')}
              </Button>
            ) : null}
          </View>
        ) : null}

        <ComposerPanel
          value={input}
          onValueChange={handleChange}
          onSubmit={handleSubmit}
          disabled={!hasContent || busy || disabled}
          placeholder={t('sindi.chat.placeholder')}
          permissions={[]}
          addMenu={addMenu}
          onAddMenuSelect={onAddMenuSelect}
          listening={listening}
          onListeningChange={setListening}
          attachments={attachments}
          onRemoveAttachment={onRemoveAttachment}
          labels={labels}
          testID="sindi-composer"
        />
      </View>
    );
  },
);
ChatComposer.displayName = 'ChatComposer';

const styles = StyleSheet.create({
  footer: {
    width: '100%',
    gap: 10,
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 10,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 6,
    minHeight: 32,
  },
  statusLead: {
    flex: 1,
    minWidth: 0,
  },
});
