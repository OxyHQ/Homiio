import { useCallback } from 'react';
import { Alert, Platform, Share } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { logger } from '@/utils/logger';
import type { Conversation } from '@/store/conversationStore';

/**
 * Public origin used to build shareable Sindi conversation links. Overridable
 * via `EXPO_PUBLIC_WEB_URL`; on web we always prefer the live `window.origin`
 * so a staging/preview host shares its own URLs.
 */
const SHARE_WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_URL || 'https://homiio.com';

type ConversationFetch = typeof globalThis.fetch;

interface UseSindiShareArgs {
  currentConversation: Conversation | null | undefined;
  generateShareToken: (
    conversationId: string,
    authenticatedFetch: ConversationFetch,
  ) => Promise<string | null>;
  authenticatedFetch: ConversationFetch;
}

/** Resolve the web origin for share links (live origin on web, configured host otherwise). */
function resolveShareOrigin(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }
  return SHARE_WEB_ORIGIN;
}

/**
 * Share the current Sindi conversation.
 *
 * Validates the conversation can be shared (persisted + non-empty), mints a
 * share token via the store, then surfaces the link through the platform's
 * native share sheet (iOS/Android), the Web Share API where available, or a
 * clipboard fallback. All user-facing copy uses the `sindi.share.*` i18n keys.
 */
export function useSindiShare({
  currentConversation,
  generateShareToken,
  authenticatedFetch,
}: UseSindiShareArgs): () => Promise<void> {
  const { t } = useTranslation();

  return useCallback(async () => {
    // Unsaved (client-generated) conversations cannot be shared yet.
    if (!currentConversation || currentConversation.id.startsWith('conv_')) {
      Alert.alert(t('sindi.share.error.title'), t('sindi.share.error.saveFirst'));
      return;
    }

    if (!currentConversation.messages || currentConversation.messages.length === 0) {
      Alert.alert(t('sindi.share.error.title'), t('sindi.share.error.emptyConversation'));
      return;
    }

    try {
      const shareToken = await generateShareToken(currentConversation.id, authenticatedFetch);
      if (!shareToken) {
        Alert.alert(t('sindi.share.error.title'), t('sindi.share.error.failed'));
        return;
      }

      const shareUrl = `${resolveShareOrigin()}/sindi/shared/${shareToken}`;
      const shareText = t('sindi.share.text');

      if (Platform.OS === 'web') {
        if (typeof navigator !== 'undefined' && navigator.share) {
          await navigator.share({
            title: currentConversation.title,
            text: shareText,
            url: shareUrl,
          });
          return;
        }
        await Clipboard.setStringAsync(shareUrl);
        Alert.alert(t('sindi.share.success.title'), t('sindi.share.success.copied'));
        return;
      }

      // Native: present the OS share sheet, falling back to the clipboard.
      const result = await Share.share({
        title: currentConversation.title,
        message: `${shareText}\n${shareUrl}`,
        url: shareUrl,
      });
      if (result.action === Share.dismissedAction) {
        // User dismissed the sheet — nothing to do.
        return;
      }
    } catch (error) {
      logger.error('Failed to share conversation:', error);
      Alert.alert(t('sindi.share.error.title'), t('sindi.share.error.failed'));
    }
  }, [currentConversation, generateShareToken, authenticatedFetch, t]);
}
