import { requireOptionalNativeModule } from 'expo';
import type { ExpoSpeechRecognitionModuleType } from 'expo-speech-recognition/build/ExpoSpeechRecognitionModule.types';
import { logger } from '@/utils/logger';
import type { SpeechCallbacks, StartSpeechRecognition } from './speechTypes';

/**
 * Native voice input through `expo-speech-recognition` (iOS `SFSpeechRecognizer`,
 * Android `SpeechRecognizer`).
 *
 * The module is looked up with `requireOptionalNativeModule` instead of
 * importing the package root, whose top level calls `requireNativeModule` and
 * THROWS in any binary built before the dependency was added (an older dev
 * client or store build). Here such a build reports `unsupported` and the
 * composer shows "not available on this device" instead of crashing the chat.
 */
const nativeModule = requireOptionalNativeModule<ExpoSpeechRecognitionModuleType>(
  'ExpoSpeechRecognition',
);

export const startSpeechRecognition: StartSpeechRecognition = (
  lang: string,
  callbacks: SpeechCallbacks,
) => {
  const recognizer = nativeModule;
  let cancelled = false;
  let started = false;

  if (!recognizer) {
    callbacks.onFailure('unsupported');
    callbacks.onEnd();
    return { stop: () => {}, abort: () => {} };
  }

  const subscriptions = [
    recognizer.addListener('result', (event) => {
      callbacks.onResult(event.results[0]?.transcript ?? '', event.isFinal);
    }),
    recognizer.addListener('error', (event) => {
      switch (event.error) {
        case 'aborted':
        case 'no-speech':
        case 'speech-timeout':
          return;
        case 'not-allowed':
          callbacks.onFailure('denied');
          return;
        case 'service-not-allowed':
          callbacks.onFailure('unsupported');
          return;
        default:
          logger.warn('Sindi voice input error:', event.error, event.message);
          callbacks.onFailure('failed');
      }
    }),
    recognizer.addListener('audiostart', () => callbacks.onCapture()),
    recognizer.addListener('end', () => finish()),
  ];

  function finish() {
    subscriptions.forEach((subscription) => subscription.remove());
    subscriptions.length = 0;
    callbacks.onEnd();
  }

  void (async () => {
    try {
      if (!recognizer.isRecognitionAvailable()) {
        callbacks.onFailure('unsupported');
        finish();
        return;
      }
      const permission = await recognizer.requestPermissionsAsync();
      if (cancelled) {
        finish();
        return;
      }
      if (!permission.granted) {
        callbacks.onFailure('denied');
        finish();
        return;
      }
      started = true;
      recognizer.start({ lang, interimResults: true, continuous: true, maxAlternatives: 1 });
    } catch (error) {
      logger.warn('Sindi voice input could not start:', error);
      callbacks.onFailure('failed');
      finish();
    }
  })();

  return {
    stop: () => {
      cancelled = true;
      if (started) recognizer.stop();
    },
    abort: () => {
      cancelled = true;
      if (started) recognizer.abort();
    },
  };
};
