import { useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { logger } from '@/utils/logger';
import { shareContent } from '@/utils/share';
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
 * share token via the store, then surfaces the link through the shared
 * `shareContent` ladder (Web Share API → native share sheet → clipboard
 * fallback). All user-facing copy uses the `sindi.share.*` i18n keys; the
 * outcome decides which (if any) confirmation to show.
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

    let shareToken: string | null;
    try {
      shareToken = await generateShareToken(currentConversation.id, authenticatedFetch);
    } catch (error) {
      logger.error('Failed to mint Sindi share token:', error);
      Alert.alert(t('sindi.share.error.title'), t('sindi.share.error.failed'));
      return;
    }

    if (!shareToken) {
      Alert.alert(t('sindi.share.error.title'), t('sindi.share.error.failed'));
      return;
    }

    const shareUrl = `${resolveShareOrigin()}/sindi/shared/${shareToken}`;
    const shareText = t('sindi.share.text');

    const outcome = await shareContent({
      title: currentConversation.title,
      // Native share sheets take a single string; pair the text with the link.
      message: `${shareText}\n${shareUrl}`,
      url: shareUrl,
      // Web Share takes `text` + `url` separately, so keep the text on its own.
      webText: shareText,
      copyText: shareUrl,
    });

    if (outcome === 'copied') {
      Alert.alert(t('sindi.share.success.title'), t('sindi.share.success.copied'));
    } else if (outcome === 'failed') {
      Alert.alert(t('sindi.share.error.title'), t('sindi.share.error.failed'));
    }
    // 'shared' / 'dismissed' → nothing to surface.
  }, [currentConversation, generateShareToken, authenticatedFetch, t]);
}
