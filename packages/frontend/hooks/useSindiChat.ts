/**
 * Everything a Homiio surface hands Alia's SDK, for one host.
 *
 * The sheet (`context/AskAgentProvider.tsx`), the panel and the full-screen chat
 * (`components/sindi/SindiConversation.tsx`) all open the same conversation
 * runtime; what differs between them is only the host, and with it what acting
 * on the app means (`components/sindi/sindiHost.ts`). So the configuration is
 * built here once per host and nowhere else:
 *
 *  - `hostTools` + `runtime` — the executor (`hooks/useSindiActions.ts`);
 *  - `clientContext` — what the screen shows (`hooks/useSindiAppContext.ts`);
 *  - `toolRenderers` — the catalogue's results as Homiio's cards;
 *  - `labels` — the chat's words from Homiio's i18n;
 *  - `onFeatureLocked` — Homiio+'s upsell, when Sindi's `sindi.files` gate
 *    refuses a document (Alia ADR 0020 §6);
 *  - `onShare` — Homiio's own share link for a minted token.
 */

import type { AliaChatLabels, AliaConversationShare } from '@alia.onl/sdk';
import { VOICE_ERROR_MESSAGES, type VoiceErrorCode } from '@alia.onl/sdk';
import { toast } from '@oxy.so/bloom/toast';
import { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { type SindiChatHost, useSindiControlCapability } from '@/components/sindi/sindiHost';
import { SINDI_TOOL_RENDERERS } from '@/components/sindi/sindiToolRenderers';
import { serializeSindiAppContext, useSindiAppContext } from '@/hooks/useSindiAppContext';
import { useSindiActions } from '@/hooks/useSindiActions';
import { useSindiUpsell } from '@/hooks/useSindiUpsell';
import { shareContent } from '@/utils/share';

/**
 * Public origin for share links. Overridable via `EXPO_PUBLIC_WEB_URL`; on web
 * the live origin wins, so a preview host shares its own URLs.
 */
const SHARE_WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_URL || 'https://homiio.com';

function shareOrigin(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return SHARE_WEB_ORIGIN;
}

/** Homiio's read-only page for a shared conversation (`app/(tabs)/sindi/shared/[token].tsx`). */
export function sindiShareUrl(token: string, origin: string = shareOrigin()): string {
  return `${origin}/sindi/shared/${encodeURIComponent(token)}`;
}

/** Hand a minted share to the platform's share sheet, falling back to the clipboard. */
export async function shareSindiConversation(
  share: AliaConversationShare,
  t: TFunction,
): Promise<void> {
  const url = sindiShareUrl(share.token);
  const text = t('sindi.share.text');
  const outcome = await shareContent({
    message: `${text}\n${url}`,
    url,
    webText: text,
    copyText: url,
  });
  if (outcome === 'copied') {
    toast.success(t('sindi.share.success.title'), {
      description: t('sindi.share.success.copied'),
    });
  } else if (outcome === 'failed') {
    toast.error(t('sindi.share.error.title'), { description: t('sindi.share.error.failed') });
  }
}

/** The dictation and call errors Homiio already words; the rest stay the SDK's English. */
const VOICE_ERROR_KEYS: Partial<Record<VoiceErrorCode, string>> = {
  'mic-denied': 'sindi.voice.deniedMessage',
  'mic-unavailable': 'sindi.voice.unsupportedDevice',
  'voice-unavailable': 'sindi.voice.unsupportedDevice',
  'connection-lost': 'sindi.voice.failed',
  'transcription-failed': 'sindi.voice.failed',
};

/** The chat's own words, in the reader's language where Homiio has them. */
export function useSindiChatLabels(): Partial<AliaChatLabels> {
  const { t, i18n } = useTranslation();
  return useMemo<Partial<AliaChatLabels>>(
    () => ({
      locale: i18n.language,
      placeholder: (leadName) => t('sindi.chat.placeholder', { name: leadName }),
      composerMessage: t('sindi.chat.field'),
      composerAddMenu: t('sindi.chat.addMenu'),
      addMenuGroup: t('sindi.chat.addGroup'),
      addDocuments: t('sindi.chat.attach'),
      composerSend: t('sindi.chat.send'),
      composerStop: t('sindi.chat.stop'),
      composerVoice: t('sindi.chat.voice'),
      composerRemove: t('sindi.chat.removeAttachment'),
      share: t('common.share'),
      newChat: t('sindi.panel.newChat'),
      voiceError: (code) => {
        const key = VOICE_ERROR_KEYS[code];
        return key ? t(key) : VOICE_ERROR_MESSAGES[code];
      },
    }),
    [t, i18n.language],
  );
}

/** The SDK configuration of one Homiio surface. */
export function useSindiChat(host: SindiChatHost) {
  const { t } = useTranslation();
  const capability = useSindiControlCapability(host);
  const appContext = useSindiAppContext(capability);
  const { hostTools, runtime } = useSindiActions(host);
  const { openUpsell } = useSindiUpsell();
  const labels = useSindiChatLabels();

  const clientContext = useMemo(
    () => serializeSindiAppContext(t('alia.clientContext'), appContext),
    [t, appContext],
  );
  // Homiio+ is the only gate Homiio publishes (`sindi.files`), so every locked
  // feature is its upsell.
  const onFeatureLocked = useCallback(() => openUpsell(), [openUpsell]);
  const onShare = useCallback(
    (share: AliaConversationShare) => void shareSindiConversation(share, t),
    [t],
  );

  return {
    hostTools,
    runtime,
    clientContext,
    labels,
    toolRenderers: SINDI_TOOL_RENDERERS,
    onFeatureLocked,
    onShare,
  };
}
