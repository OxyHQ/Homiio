/**
 * "Ask Alia" and "Ask Sindi": the SDK's one sheet, mounted once above the app
 * frame (a drawer unmounts when it closes, so it cannot live beside the row
 * that opens it).
 *
 * Alia is Homiio's main AI; "Ask Sindi" opens the SAME dialog with Sindi's
 * character, name and greeting (Alia ADR 0020 §6). Anything below calls
 * `useAskGemie().ask('alia' | 'sindi', turn?)` from `@gemies/sdk/ask`, which loads the
 * sheet with the first ask; signed out, the SDK opens Oxy's sign-in instead.
 *
 * It is the ONLY surface Sindi and Alia have in Homiio. It floats over
 * whatever page the person was reading, so a host tool changes the page UNDER
 * it and the sheet closes once the answer is written (`hooks/useSindiActions.ts`),
 * through the provider's ref — the code configuring the sheet sits above it,
 * where `useAskGemie()` cannot reach. The executor also has to see each turn
 * start, which is the `GemieRuntimeProvider` around it.
 *
 * Must sit inside `OxyProvider` (auth), `I18nextProvider`, the router and the
 * providers the cards read (saved homes).
 */

import type { GemieSuggestion } from '@gemies/sdk';
import { type GemieAsk, GemieAskProvider } from '@gemies/sdk/ask';
import { GemieRuntimeProvider } from '@gemies/sdk/runtime';
import type React from 'react';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { HOMIIO_AGENTS } from '@/components/sindi/sindiAgent';
import { SINDI_HOST_APP } from '@/components/sindi/sindiHostTools';
import { useSindiChat } from '@/hooks/useSindiChat';

export function AskAgentProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const sheet = useRef<GemieAsk>(null);
  const closeSheet = useCallback(() => sheet.current?.dismiss(), []);
  const chat = useSindiChat(closeSheet);

  // Alia's lines over her empty composer; Sindi offers her own starters.
  const welcomeSuggestions = useMemo<GemieSuggestion[]>(
    () => [
      { id: 'find', text: t('alia.suggestion.find') },
      { id: 'costs', text: t('alia.suggestion.costs') },
      { id: 'rights', text: t('alia.suggestion.rights') },
    ],
    [t],
  );

  return (
    // `app`: the conversations the sheet starts are Homiio's, its recents list only those, and
    // its host tools are Homiio's (SDK 21, Alia `docs/agent-embedding.md` §6).
    <GemieRuntimeProvider host={chat.runtime} app={SINDI_HOST_APP}>
      <GemieAskProvider
        ref={sheet}
        app={SINDI_HOST_APP}
        agents={HOMIIO_AGENTS}
        hostTools={chat.hostTools}
        toolRenderers={chat.toolRenderers}
        labels={chat.labels}
        clientContext={chat.clientContext}
        onFeatureLocked={chat.onFeatureLocked}
        onShare={chat.onShare}
        welcomeSuggestions={welcomeSuggestions}
      >
        {children}
      </GemieAskProvider>
    </GemieRuntimeProvider>
  );
}
