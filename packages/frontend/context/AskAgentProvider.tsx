/**
 * "Ask Alia" and "Ask Sindi": the SDK's one sheet, mounted once above the app
 * frame (a drawer unmounts when it closes, so it cannot live beside the row
 * that opens it).
 *
 * Alia is Homiio's main AI; "Ask Sindi" opens the SAME dialog with Sindi's
 * character, name and greeting (Alia ADR 0020 §6). Anything below calls
 * `useAskAgent().ask('alia' | 'sindi', turn?)` from `@alia.onl/sdk`; signed
 * out, the SDK opens Oxy's sign-in instead.
 *
 * The sheet floats over whatever page the person was reading, so it is the
 * `sheet` host: its host tools answer `inline` and move nothing
 * (`components/sindi/sindiHost.ts`). The executor still has to see each turn
 * start, which is the `AliaRuntimeProvider` around it.
 *
 * Must sit inside `OxyProvider` (auth), `I18nextProvider`, the router and the
 * providers the cards read (saved homes).
 */

import { AliaAskProvider, AliaRuntimeProvider, type AliaSuggestion } from '@alia.onl/sdk';
import type React from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { HOMIIO_AGENTS } from '@/components/sindi/sindiAgent';
import { useSindiChat } from '@/hooks/useSindiChat';

export function AskAgentProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const chat = useSindiChat('sheet');

  // Alia's lines over her empty composer; Sindi offers her own starters.
  const welcomeSuggestions = useMemo<AliaSuggestion[]>(
    () => [
      { id: 'find', text: t('alia.suggestion.find') },
      { id: 'costs', text: t('alia.suggestion.costs') },
      { id: 'rights', text: t('alia.suggestion.rights') },
    ],
    [t],
  );

  return (
    <AliaRuntimeProvider host={chat.runtime}>
      <AliaAskProvider
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
      </AliaAskProvider>
    </AliaRuntimeProvider>
  );
}
