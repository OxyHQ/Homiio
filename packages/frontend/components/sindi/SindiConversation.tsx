/**
 * A conversation with Sindi, drawn by Alia's SDK (`AliaChatContent agent={sindi}`).
 *
 * The docked/overlay panel and the full-screen route mount this; the sheet is
 * the SDK's own (`context/AskAgentProvider.tsx`). Homiio brings only what is
 * Homiio's — the host tools, the screen's context, the cards, the words, the
 * upsell — through `hooks/useSindiChat.ts`, and the conversation, its history,
 * titles, voice, attachments and streaming are Alia's (Alia ADR 0018/0020).
 */

import {
  ALIA_CHARACTER_RUNTIME_URL,
  AliaChatContent,
  type AliaChatContentProps,
  type AliaRuntimeHost,
  type AliaSuggestion,
} from '@alia.onl/sdk';
import { AgentAvatarProvider } from '@oxy.so/bloom/agent-avatar';
import { useTheme } from '@oxy.so/bloom/theme';
import { useMemo } from 'react';

import { SINDI_AGENT } from '@/components/sindi/sindiAgent';
import type { SindiChatHost } from '@/components/sindi/sindiHost';
import { useSindiChat } from '@/hooks/useSindiChat';
import { useSindiPreferences } from '@/store/sindiPreferencesStore';

/** No starters on the empty chat: the person turned tips off. One array, so nothing re-renders for a new `[]`. */
const NO_TIPS: AliaSuggestion[] = [];

export interface SindiConversationProps {
  /** Which surface this is; decides what acting on the app means (`sindiHost.ts`). */
  host: Exclude<SindiChatHost, 'sheet'>;
  /** The conversation to show; omitted, a new one is made with the first turn. */
  conversationId?: string;
  /** The chat opened a conversation (a new one) or left it. */
  onConversationChange?: (conversationId: string | undefined) => void;
  /**
   * A host that owns the address of the conversation (the route) opens it there:
   * the SDK then hands the first turn to the conversation's own mount.
   */
  openConversation?: AliaRuntimeHost['openConversation'];
  closeConversation?: AliaRuntimeHost['closeConversation'];
  /** What the surface draws around the thread. */
  chrome?: AliaChatContentProps['chrome'];
  /** A turn sent once as the chat mounts (`/sindi/new?message=…`). */
  initialTurn?: AliaChatContentProps['initialTurn'];
  bottomInset?: number;
}

export function SindiConversation({
  host,
  conversationId,
  onConversationChange,
  openConversation,
  closeConversation,
  chrome,
  initialTurn,
  bottomInset,
}: SindiConversationProps) {
  const { isDark } = useTheme();
  const chat = useSindiChat(host);
  const tips = useSindiPreferences((state) => state.tips);

  const runtime = useMemo<AliaRuntimeHost>(
    () => ({
      ...chat.runtime,
      ...(openConversation ? { openConversation } : {}),
      ...(closeConversation ? { closeConversation } : {}),
    }),
    [chat.runtime, openConversation, closeConversation],
  );

  return (
    <AgentAvatarProvider runtimeUrl={ALIA_CHARACTER_RUNTIME_URL}>
      <AliaChatContent
        agent={SINDI_AGENT}
        conversationId={conversationId}
        onConversationChange={onConversationChange}
        runtime={runtime}
        hostTools={chat.hostTools}
        toolRenderers={chat.toolRenderers}
        clientContext={chat.clientContext}
        labels={chat.labels}
        onFeatureLocked={chat.onFeatureLocked}
        // Omitted, the agent's own starters; off, none.
        welcomeSuggestions={tips ? undefined : NO_TIPS}
        chrome={chrome}
        initialTurn={initialTurn}
        isDarkMode={isDark}
        layout={host === 'panel' ? 'sheet' : 'screen'}
        bottomInset={bottomInset}
      />
    </AgentAvatarProvider>
  );
}
