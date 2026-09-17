import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { toast } from '@oxy.so/bloom/toast';
import { startSpeechRecognition } from './speechEngine';
import type { SpeechFailure, SpeechSession } from './speechTypes';

export interface UseVoiceDraftArgs {
  /** The current draft. Dictation continues from whatever it holds when the mic opens. */
  value: string;
  onChange: (text: string) => void;
}

export interface UseVoiceDraftResult {
  /** Drives `ComposerPanel`'s `listening`. */
  listening: boolean;
  /** `ComposerPanel`'s `onListeningChange`: opens or closes the mic. */
  setListening: (listening: boolean) => void;
  /**
   * Close the mic and DISCARD any result still pending — for send and stop,
   * where a late final result must not refill a draft that was just sent.
   */
  cancel: () => void;
}

/** Joins the draft and the dictated pieces with single spaces. */
function joinDraft(...parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Voice dictation into the composer draft. Interim results update the draft
 * live; final results are appended to it. Recognition runs in the app language
 * (`i18n.language`). The mic closes on send/stop (`cancel`), when the page or
 * window loses focus (web) or the app leaves the foreground (native), and on
 * unmount. Unsupported platforms and refused permissions end in a toast with
 * `listening` back to false — the mic is never a dead control.
 *
 * Web uses the Web Speech API; native uses `expo-speech-recognition`, which
 * needs a binary built with that module (see `speechEngine.ts`).
 */
export function useVoiceDraft({ value, onChange }: UseVoiceDraftArgs): UseVoiceDraftResult {
  const { t, i18n } = useTranslation();
  const [listening, setListeningState] = useState(false);
  /** The mic is actually capturing (permission granted), not just requested. */
  const [capturing, setCapturing] = useState(false);

  const sessionRef = useRef<SpeechSession | null>(null);
  /** Incremented per session; callbacks from an older session are ignored. */
  const generationRef = useRef(0);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  }, [value, onChange]);

  const announceFailure = useCallback(
    (failure: SpeechFailure) => {
      if (failure === 'unsupported') {
        toast.error(
          t(Platform.OS === 'web' ? 'sindi.voice.unsupportedBrowser' : 'sindi.voice.unsupportedDevice'),
        );
      } else if (failure === 'denied') {
        toast.error(t('sindi.voice.deniedTitle'), { description: t('sindi.voice.deniedMessage') });
      } else {
        toast.error(t('sindi.voice.failed'));
      }
    },
    [t],
  );

  const start = useCallback(() => {
    if (sessionRef.current) return;
    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation;

    const base = valueRef.current;
    let settled = '';
    let ended = false;
    setListeningState(true);

    const session = startSpeechRecognition(i18n.language, {
      onResult: (transcript, isFinal) => {
        if (!isCurrent()) return;
        if (isFinal) {
          settled = joinDraft(settled, transcript);
          onChangeRef.current(joinDraft(base, settled));
        } else {
          onChangeRef.current(joinDraft(base, settled, transcript));
        }
      },
      onCapture: () => {
        if (isCurrent()) setCapturing(true);
      },
      onFailure: (failure) => {
        if (!isCurrent()) return;
        announceFailure(failure);
      },
      onEnd: () => {
        ended = true;
        if (!isCurrent()) return;
        sessionRef.current = null;
        setListeningState(false);
        setCapturing(false);
      },
    });
    // An engine that cannot start ends synchronously, before it returns.
    if (!ended) sessionRef.current = session;
  }, [announceFailure, i18n.language]);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    setListeningState(false);
  }, []);

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    // Detach first so nothing the recogniser flushes reaches the draft.
    generationRef.current += 1;
    sessionRef.current = null;
    session.abort();
    setListeningState(false);
    setCapturing(false);
  }, []);

  const setListening = useCallback(
    (next: boolean) => {
      if (next) start();
      else stop();
    },
    [start, stop],
  );

  // Close the mic when the app goes to the background / the tab is hidden, and
  // (web) when the window loses focus. Armed only once audio capture has begun:
  // a permission prompt can blur the window (web) or make the app `inactive`
  // (iOS), and closing on that would make the first tap never listen.
  useEffect(() => {
    if (!listening || !capturing) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') stop();
    });
    const onWindowBlur = () => stop();
    const canListenToWindow = Platform.OS === 'web' && typeof window !== 'undefined';
    if (canListenToWindow) window.addEventListener('blur', onWindowBlur);
    return () => {
      subscription.remove();
      if (canListenToWindow) window.removeEventListener('blur', onWindowBlur);
    };
  }, [listening, capturing, stop]);

  useEffect(() => cancel, [cancel]);

  return { listening, setListening, cancel };
}
