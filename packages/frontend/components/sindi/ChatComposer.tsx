import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { colors } from '@/styles/colors';
import { sindiStyles } from './styles';

const MAX_MESSAGE_LENGTH = 1000;
const ENTER_KEY = 'Enter';

/**
 * Cross-platform shape of a key event. On native RN delivers
 * `{ nativeEvent: { key } }`; on web (RN-Web) the event carries `key`,
 * `shiftKey`, and the DOM `preventDefault`/`stopPropagation` methods directly.
 */
interface ComposerKeyEvent {
  nativeEvent?: { key?: string; shiftKey?: boolean };
  key?: string;
  shiftKey?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

/** Attached document preview (subset of `DocumentPicker` asset we display). */
export interface AttachedFilePreview {
  name?: string;
}

export interface ChatComposerProps {
  input: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  onAttachFile: () => void;
  onRemoveFile: () => void;
  attachedFile: AttachedFilePreview | null;
  isLoading: boolean;
  isUploading: boolean;
  /** Web sticky-positioning override applied by the parent. */
  stickyStyle?: StyleProp<ViewStyle>;
}

/**
 * Chat composer / input bar: attachment button, multiline text field, and send
 * button, with an optional attached-file preview chip.
 *
 * Submit is wired three ways, matching the original behavior exactly:
 *  - `onSubmitEditing` on native (non-web),
 *  - Enter (without Shift) via `onKeyPress`, preventing the web newline,
 *  - the send button.
 */
export const ChatComposer = React.memo<ChatComposerProps>(
  ({
    input,
    onChangeText,
    onSubmit,
    onAttachFile,
    onRemoveFile,
    attachedFile,
    isLoading,
    isUploading,
    stickyStyle,
  }) => {
    const { t } = useTranslation();
    const [sendPressed, setSendPressed] = useState(false);

    const hasContent = Boolean(input.trim() || attachedFile);
    // The button is non-interactive while streaming, but only dimmed when there
    // is nothing to send or an upload is in flight (preserving original visuals:
    // a loading-but-has-content state stays bright yet disabled).
    const sendDisabled = !hasContent || isLoading || isUploading;
    const sendDimmed = !hasContent || isUploading;
    const accentColor = hasContent ? colors.primaryColor : colors.muted;

    const handleKeyPress = (event: ComposerKeyEvent): void => {
      const key = event.nativeEvent?.key ?? event.key;
      const shift = event.nativeEvent?.shiftKey ?? event.shiftKey;
      if (key !== ENTER_KEY || shift) return;

      if (Platform.OS === 'web') {
        event.preventDefault?.();
        event.stopPropagation?.();
      }
      if (!isLoading && !isUploading && hasContent) {
        onSubmit();
      }
    };

    return (
      <View style={[sindiStyles.stickyInput, stickyStyle]}>
        <View style={sindiStyles.inputBar}>
          <View style={sindiStyles.inputContainer}>
            {attachedFile ? (
              <View style={sindiStyles.filePreviewContainer}>
                <BloomText style={sindiStyles.filePreviewText} numberOfLines={1}>
                  {attachedFile.name}
                </BloomText>
                <Pressable
                  onPress={onRemoveFile}
                  style={sindiStyles.removeFileButton}
                  accessibilityRole="button"
                  accessibilityLabel="Remove file"
                >
                  <Ionicons name="close-circle" size={18} color={colors.danger} />
                </Pressable>
              </View>
            ) : null}

            <View style={sindiStyles.inputWrapper}>
              <Pressable
                onPress={onAttachFile}
                style={sindiStyles.attachButton}
                accessibilityRole="button"
                accessibilityLabel="Attach file"
              >
                <Ionicons name="attach" size={20} color={colors.muted} />
              </Pressable>

              <TextInput
                style={sindiStyles.textInput}
                placeholder={t('sindi.chat.placeholder')}
                placeholderTextColor={colors.muted}
                value={input}
                onChangeText={onChangeText}
                onSubmitEditing={Platform.OS !== 'web' ? onSubmit : undefined}
                onKeyPress={handleKeyPress}
                multiline
                blurOnSubmit={false}
                returnKeyType={Platform.OS === 'ios' ? 'send' : 'done'}
                maxLength={MAX_MESSAGE_LENGTH}
              />

              <Pressable
                style={[
                  sindiStyles.sendButtonPlain,
                  sendDimmed && sindiStyles.sendButtonDisabledPlain,
                  sendPressed && sindiStyles.sendButtonPressed,
                ]}
                onPress={onSubmit}
                onPressIn={() => setSendPressed(true)}
                onPressOut={() => setSendPressed(false)}
                disabled={sendDisabled}
                accessibilityRole="button"
                accessibilityLabel="Send message"
              >
                <Ionicons
                  name={isLoading || isUploading ? 'hourglass' : 'send'}
                  size={20}
                  color={accentColor}
                />
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    );
  },
);
ChatComposer.displayName = 'ChatComposer';
