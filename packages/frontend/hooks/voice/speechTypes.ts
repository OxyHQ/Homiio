/**
 * The contract both speech engines (`speechEngine.ts` native,
 * `speechEngine.web.ts` Web Speech API) implement for `useVoiceDraft`.
 */

/** Why a session ended badly — each maps to one user-facing toast. */
export type SpeechFailure =
  /** No recogniser on this platform/browser, or the native module is absent from the build. */
  | 'unsupported'
  /** Microphone or speech-recognition permission was refused. */
  | 'denied'
  /** Anything else (network, audio capture, unsupported language…). */
  | 'failed';

export interface SpeechCallbacks {
  /** Audio capture began — permission was granted and the mic is live. */
  onCapture: () => void;
  /**
   * A transcript for the current utterance. `isFinal: false` is the live
   * interim text (it REPLACES the previous interim); `isFinal: true` is settled
   * text to append.
   */
  onResult: (transcript: string, isFinal: boolean) => void;
  onFailure: (failure: SpeechFailure) => void;
  /** Always the last callback of a session, including after a failure. */
  onEnd: () => void;
}

export interface SpeechSession {
  /** Stop listening and deliver any pending final result. */
  stop: () => void;
  /** Stop listening and discard anything pending. */
  abort: () => void;
}

export type StartSpeechRecognition = (lang: string, callbacks: SpeechCallbacks) => SpeechSession;
