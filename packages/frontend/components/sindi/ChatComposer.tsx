import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AgentChatComposer, type AgentChatComposerLabels } from '@oxy.so/bloom/agent-chat';
import { AgentThinking } from '@oxy.so/bloom/agent-thinking';
import { Chip } from '@oxy.so/bloom/chip';
import { RiAttachment2 } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';

const MAX_MESSAGE_LENGTH = 1000;

/** Attached document preview (subset of `DocumentPicker` asset we display). */
export interface AttachedFilePreview {
  name?: string;
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
  messageCount: number;
}

/**
 * The Sindi composer: Bloom agent-chat's pill composer (attach, field, send /
 * stop, the `ComposerLoader` light band while a reply streams) with the
 * attached file as a dismissible chip above it, and `AgentThinking` while
 * Sindi is working but nothing has streamed yet.
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
    messageCount,
  }) => {
    const { t } = useTranslation();
    const { colors } = useTheme();

    const labels = useMemo<AgentChatComposerLabels>(
      () => ({
        field: t('sindi.chat.field'),
        placeholder: t('sindi.chat.placeholder'),
        attach: t('sindi.chat.attach'),
        send: t('sindi.chat.send'),
        stop: t('sindi.chat.stop'),
        newChat: t('sindi.panel.newChat'),
        messageCount: (count: number) => t('sindi.chat.messageCount', { count }),
      }),
      [t],
    );

    const handleChange = useCallback(
      (text: string) => onChangeText(text.slice(0, MAX_MESSAGE_LENGTH)),
      [onChangeText],
    );

    const hasContent = Boolean(input.trim() || attachedFile);
    const handleSubmit = useCallback(() => {
      // Enter reaches here even while busy; the hook's own guards stay the
      // authority, this only refuses the obvious no-ops.
      if (!hasContent || isLoading || isUploading || disabled) return;
      onSubmit();
    }, [hasContent, isLoading, isUploading, disabled, onSubmit]);

    // Reasoning streams nothing visible first, so the indicator stays up until
    // a word exists (Bloom agent-chat's rule); an upload has no stream at all.
    const thinking = isUploading || (isLoading && !hasStreamedText);

    return (
      <View style={styles.footer}>
        {thinking ? (
          <AgentThinking variant="infinity" label={t('sindi.status.thinking')} style={styles.inset} />
        ) : null}

        {attachedFile ? (
          <View style={styles.attachment}>
            <Chip
              size="medium"
              startIcon={<RiAttachment2 width={16} height={16} fill={colors.textSecondary} />}
              onClose={isUploading ? undefined : onRemoveFile}
              accessibilityLabel={attachedFile.name}
            >
              {attachedFile.name}
            </Chip>
          </View>
        ) : null}

        <AgentChatComposer
          value={input}
          onValueChange={handleChange}
          onSubmit={handleSubmit}
          onStop={onStop}
          busy={isLoading}
          onAttach={onAttachFile}
          provider={t('sindi.panel.subtitle')}
          messageCount={messageCount}
          disabled={disabled || isUploading}
          labels={labels}
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
  inset: {
    paddingHorizontal: 6,
  },
  attachment: {
    flexDirection: 'row',
    paddingHorizontal: 6,
  },
});
