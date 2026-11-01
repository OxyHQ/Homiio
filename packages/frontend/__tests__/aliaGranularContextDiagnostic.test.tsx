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

import { render, fireEvent } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { AliaAskProvider } from '@alia.onl/sdk';

const mockSignIn = jest.fn(async () => undefined);
jest.mock('@oxy.so/services/ui/client', () => ({
  useAuth: () => ({ canUsePrivateApi: false, signIn: mockSignIn }),
  useOxy: () => ({ currentLanguage: 'en-US' }),
}));

function AskFromOtherEntry() {
  const ask = askUseAskAgent();
  return <Pressable accessibilityLabel="Ask" onPress={() => ask.ask()}><Text>Ask</Text></Pressable>;
}

it('the ask entry hook reads the actual root provider context', () => {
  const screen = render(<AliaAskProvider><AskFromOtherEntry /></AliaAskProvider>);
  fireEvent.press(screen.getByLabelText('Ask'));
  expect(mockSignIn).toHaveBeenCalledTimes(1);
  screen.unmount();
});
