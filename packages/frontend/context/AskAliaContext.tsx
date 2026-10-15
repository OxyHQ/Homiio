import type React from 'react';
import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AliaChatSheet, type AliaChatSheetRef } from '@alia.onl/sdk';
import { VoiceSession } from '@alia.onl/sdk/voice';
import { useAuth } from '@oxy.so/services';

interface AskAliaContextType {
  /**
   * Open the Alia chat sheet. Signed out, the sheet is not mounted (it could
   * not call Alia), so this opens the in-app Oxy sign-in dialog instead.
   */
  askAlia: () => void;
}

const AskAliaContext = createContext<AskAliaContextType | undefined>(undefined);

export const useAskAlia = (): AskAliaContextType => {
  const context = useContext(AskAliaContext);
  if (!context) {
    throw new Error('useAskAlia must be used within an AskAliaProvider');
  }
  return context;
};

/**
 * Owns the one `AliaChatSheet` and the way to open it. The entry point is the
 * sidebar's "Ask Alia" row, so the sheet is mounted here, once, above the app
 * frame rather than beside the row (a drawer unmounts when it closes). The SDK
 * greets and loads the 3D avatar from alia.onl itself.
 *
 * Must sit inside `OxyProvider` (auth), `I18nextProvider` and the router.
 */
export const AskAliaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const pathname = usePathname() || '/';
  const { canUsePrivateApi, signIn } = useAuth();
  const chatRef = useRef<AliaChatSheetRef>(null);

  const welcomeSuggestions = useMemo(
    () => [
      { id: 'find', text: t('alia.suggestion.find') },
      { id: 'costs', text: t('alia.suggestion.costs') },
      { id: 'rights', text: t('alia.suggestion.rights') },
    ],
    [t],
  );

  const clientContext = `${t('alia.clientContext')} ${t('alia.onScreen', { path: pathname })}`;

  const askAlia = useCallback(() => {
    if (canUsePrivateApi) chatRef.current?.present();
    else void signIn();
  }, [canUsePrivateApi, signIn]);

  const value = useMemo<AskAliaContextType>(() => ({ askAlia }), [askAlia]);

  return (
    <AskAliaContext.Provider value={value}>
      {children}
      {canUsePrivateApi && (
        <AliaChatSheet
          ref={chatRef}
          voiceSession={VoiceSession}
          clientContext={clientContext}
          welcomeSuggestions={welcomeSuggestions}
        />
      )}
    </AskAliaContext.Provider>
  );
};
