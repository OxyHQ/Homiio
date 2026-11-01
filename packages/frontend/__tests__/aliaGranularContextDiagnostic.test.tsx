/** Alia's native audio module is unavailable in Jest; context code is real. */
jest.mock('expo-audio', () => ({ RecordingPresets: { HIGH_QUALITY: {} } }));
import { useAskAgent as rootUseAskAgent, useAliaRuntime as rootUseAliaRuntime, AliaRuntimeProvider as rootRuntimeProvider } from '@alia.onl/sdk';
import { useAskAgent as askUseAskAgent } from '@alia.onl/sdk/ask';
import { useAliaRuntime as runtimeUseAliaRuntime, AliaRuntimeProvider as runtimeProvider } from '@alia.onl/sdk/runtime';

it('shares the ask and runtime context APIs across SDK entry paths', () => {
  expect(rootUseAskAgent).toBe(askUseAskAgent);
  expect(rootUseAliaRuntime).toBe(runtimeUseAliaRuntime);
  expect(rootRuntimeProvider).toBe(runtimeProvider);
});
