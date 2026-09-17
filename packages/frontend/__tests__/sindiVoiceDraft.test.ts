/**
 * Sindi's composer mic (`useVoiceDraft`) against a scripted speech engine:
 * interim results update the draft live, final results are appended to what
 * was already typed, send/stop (`cancel`) discards anything the recogniser
 * flushes afterwards, and a platform with no recogniser toasts and never
 * leaves the mic stuck on.
 */
import { act, renderHook } from '@testing-library/react-native';
import type { SpeechCallbacks } from '@/hooks/voice/speechTypes';
import { useVoiceDraft } from '@/hooks/voice/useVoiceDraft';

const mockToastError = jest.fn();
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { error: (...args: unknown[]) => mockToastError(...args) } }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'es' } }),
}));

type MockScript = { lang?: string; callbacks?: SpeechCallbacks; stop: jest.Mock; abort: jest.Mock; unsupported: boolean };
const mockScript: MockScript = { stop: jest.fn(), abort: jest.fn(), unsupported: false };

jest.mock('@/hooks/voice/speechEngine', () => ({
  startSpeechRecognition: (lang: string, callbacks: SpeechCallbacks) => {
    mockScript.lang = lang;
    mockScript.callbacks = callbacks;
    if (mockScript.unsupported) {
      callbacks.onFailure('unsupported');
      callbacks.onEnd();
    }
    return { stop: mockScript.stop, abort: mockScript.abort };
  },
}));

function setup(initial: string) {
  let draft = initial;
  const onChange = jest.fn((text: string) => {
    draft = text;
  });
  const hook = renderHook(() => useVoiceDraft({ value: draft, onChange }));
  return { hook, onChange, draft: () => draft };
}

beforeEach(() => {
  mockScript.callbacks = undefined;
  mockScript.unsupported = false;
  mockScript.stop.mockReset();
  mockScript.abort.mockReset();
  mockToastError.mockReset();
});

test('dictates into the draft in the app language: interim live, finals appended', () => {
  const { hook, draft } = setup('Hi Sindi,');
  act(() => hook.result.current.setListening(true));
  expect(hook.result.current.listening).toBe(true);
  expect(mockScript.lang).toBe('es');

  act(() => mockScript.callbacks!.onResult('what are', false));
  expect(draft()).toBe('Hi Sindi, what are');
  act(() => mockScript.callbacks!.onResult('what are my rights', true));
  act(() => mockScript.callbacks!.onResult('', false));
  expect(draft()).toBe('Hi Sindi, what are my rights');
  act(() => mockScript.callbacks!.onResult('as a tenant', false));
  expect(draft()).toBe('Hi Sindi, what are my rights as a tenant');

  act(() => hook.result.current.setListening(false));
  expect(mockScript.stop).toHaveBeenCalled();
  expect(hook.result.current.listening).toBe(false);
});

test('cancel (send / stop) aborts and ignores whatever the recogniser flushes', () => {
  const { hook, onChange } = setup('');
  act(() => hook.result.current.setListening(true));
  const callbacks = mockScript.callbacks!;
  act(() => hook.result.current.cancel());
  expect(mockScript.abort).toHaveBeenCalled();
  expect(hook.result.current.listening).toBe(false);

  onChange.mockClear();
  act(() => {
    callbacks.onResult('late final', true);
    callbacks.onEnd();
  });
  expect(onChange).not.toHaveBeenCalled();
});

test('an unsupported platform toasts and the mic does not stay on', () => {
  mockScript.unsupported = true;
  const { hook } = setup('');
  act(() => hook.result.current.setListening(true));
  expect(hook.result.current.listening).toBe(false);
  expect(mockToastError).toHaveBeenCalledWith('sindi.voice.unsupportedDevice');

  // A second tap tries again rather than hitting a stuck session.
  act(() => hook.result.current.setListening(true));
  expect(mockToastError).toHaveBeenCalledTimes(2);
});

test('a refused permission toasts and ends listening', () => {
  const { hook } = setup('');
  act(() => hook.result.current.setListening(true));
  act(() => {
    mockScript.callbacks!.onFailure('denied');
    mockScript.callbacks!.onEnd();
  });
  expect(mockToastError).toHaveBeenCalledWith('sindi.voice.deniedTitle', { description: 'sindi.voice.deniedMessage' });
  expect(hook.result.current.listening).toBe(false);
});
