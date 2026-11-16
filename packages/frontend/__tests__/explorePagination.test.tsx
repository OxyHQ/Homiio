/** Exercise the shared collection scroller used by Explore, including short pages. */
import { act, fireEvent, render } from '@testing-library/react-native';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { Text } from 'react-native';
import { BloomThemeProvider } from '@oxy.so/bloom/theme';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const layout = (height: number) => ({
  nativeEvent: { layout: { x: 0, y: 0, width: 400, height } },
});

function list(enabled = true) {
  const onEndReached = jest.fn();
  const rendered = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 400, height: 800 },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      }}
    >
      <BloomThemeProvider fonts={false}>
        <Screen kind="collection">
          <ScreenScrollView testID="results" onEndReached={enabled ? onEndReached : undefined}>
            <Text>Results</Text>
          </ScreenScrollView>
        </Screen>
      </BloomThemeProvider>
    </SafeAreaProvider>,
  );
  const results = rendered.getByTestId('results');
  return {
    onEndReached,
    viewport: (height: number) => fireEvent(results, 'layout', layout(height)),
    content: (height: number) => act(() => fireEvent(results, 'contentSizeChange', 400, height)),
  };
}

describe('Explore collection pagination', () => {
  it('requests another page when results do not fill the viewport', () => {
    const results = list();
    results.viewport(800);
    results.content(500);
    expect(results.onEndReached).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate a page request until content grows', () => {
    const results = list();
    results.viewport(800);
    results.content(500);
    results.viewport(800);
    results.content(500);
    expect(results.onEndReached).toHaveBeenCalledTimes(1);
    results.content(700);
    expect(results.onEndReached).toHaveBeenCalledTimes(2);
  });

  it('does not request a page while the end is far below the viewport', () => {
    const results = list();
    results.viewport(800);
    results.content(4000);
    expect(results.onEndReached).not.toHaveBeenCalled();
  });

  it('does not request a page without content or without a pagination callback', () => {
    const empty = list();
    empty.viewport(800);
    empty.content(0);
    expect(empty.onEndReached).not.toHaveBeenCalled();
    const exhausted = list(false);
    exhausted.viewport(800);
    exhausted.content(500);
    expect(exhausted.onEndReached).not.toHaveBeenCalled();
  });
});
