/**
 * Everything Homiio hands Alia's SDK for its one sheet
 * (`context/AskAgentProvider.tsx`), built here and nowhere else:
 *
 *  - `hostTools` + `runtime` — the executor (`hooks/useSindiActions.ts`);
 *  - `clientContext` — what the screen shows (`hooks/useSindiAppContext.ts`);
 *  - `toolRenderers` — the catalogue's results as Homiio's cards;
 *  - `labels` — the chat's words from Homiio's i18n;
 *  - `onFeatureLocked` — Homiio+'s upsell, when Sindi's `sindi.files` gate
 *    refuses a document (Alia ADR 0020 §6);
 *  - `onShare` — hands on the minted link, Alia's one shared page.
 */

import type { AliaChatLabels, AliaConversationShare } from '@alia.onl/sdk';
import { VOICE_ERROR_MESSAGES, type VoiceErrorCode } from '@alia.onl/sdk';
import { toast } from '@oxy.so/bloom/toast';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { SINDI_TOOL_RENDERERS } from '@/components/sindi/sindiToolRenderers';
import { serializeSindiAppContext, useSindiAppContext } from '@/hooks/useSindiAppContext';
import { useSindiActions } from '@/hooks/useSindiActions';
import { useSindiUpsell } from '@/hooks/useSindiUpsell';
import { shareContent } from '@/utils/share';

/** Hand a minted share to the platform's share sheet, falling back to the clipboard. */
export async function shareSindiConversation(
  share: AliaConversationShare,
  t: TFunction,
): Promise<void> {
  const { url } = share;
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

/**
 * The sheet's SDK configuration. `closeSheet` is the sheet's own dismiss, run
 * by the executor once a turn that acted on the page has been written.
 */
export function useSindiChat(closeSheet: () => void) {
  const { t } = useTranslation();
  const appContext = useSindiAppContext();
  const { hostTools, runtime } = useSindiActions(closeSheet);
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
