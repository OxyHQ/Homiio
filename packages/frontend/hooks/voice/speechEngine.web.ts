import type { SpeechCallbacks, SpeechSession, StartSpeechRecognition } from './speechTypes';

/**
 * Web voice input through the browser's Web Speech API (`SpeechRecognition`,
 * prefixed `webkitSpeechRecognition` in Chrome and Safari). Firefox and Brave
 * have no recogniser, so they report `unsupported`.
 *
 * The minimal shapes are declared here because the DOM lib does not ship them
 * for every TypeScript version the toolchain uses.
 */

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionResultEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: RecognitionResult };
}
interface RecognitionErrorEvent {
  readonly error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onaudiostart: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

const NOOP_SESSION: SpeechSession = { stop: () => {}, abort: () => {} };

export const startSpeechRecognition: StartSpeechRecognition = (
  lang: string,
  callbacks: SpeechCallbacks,
) => {
  const Constructor = recognitionConstructor();
  if (!Constructor) {
    callbacks.onFailure('unsupported');
    callbacks.onEnd();
    return NOOP_SESSION;
  }

  const recognition = new Constructor();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript ?? '';
      if (result.isFinal) callbacks.onResult(transcript, true);
      else interim += transcript;
    }
    callbacks.onResult(interim, false);
  };
  recognition.onerror = (event) => {
    switch (event.error) {
      // Our own abort, or silence: the session simply ends.
      case 'aborted':
      case 'no-speech':
        return;
      case 'not-allowed':
      case 'service-not-allowed':
        callbacks.onFailure('denied');
        return;
      default:
        callbacks.onFailure('failed');
    }
  };
  recognition.onaudiostart = () => callbacks.onCapture();
  recognition.onend = () => callbacks.onEnd();

  try {
    recognition.start();
  } catch {
    callbacks.onFailure('failed');
    callbacks.onEnd();
    return NOOP_SESSION;
  }

  return {
    stop: () => recognition.stop(),
    abort: () => recognition.abort(),
  };
};
