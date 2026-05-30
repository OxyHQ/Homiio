/**
 * Render smoke test for ThemedText. Beyond asserting the component renders its
 * children for each `type` variant, this proves the full jest-expo rendering
 * path works on RN 0.85 / React 19: it mounts a real component tree (via
 * react-test-renderer 19.2.3, bundled by jest-expo) and exercises the Babel
 * transform for Bloom (`@oxyhq/bloom/*`) sources whose `react-native` export
 * condition resolves to raw `.tsx`.
 *
 * ThemedText renders Bloom typography, which reads the theme via `useTheme`, so
 * it must mount under a `BloomThemeProvider` exactly like the running app
 * (app/_layout.tsx). We disable `fonts` so the provider renders children
 * synchronously with no async font-loading side effects.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
// Import from the dedicated `theme` subpath (as the app does for `portal`/
// `typography`) rather than the Bloom barrel, so the test only pulls the theme
// provider — not toast/dialog/bottom-sheet and their heavy transitive deps.
import { BloomThemeProvider } from '@oxyhq/bloom/theme';

import { ThemedText } from '@/components/ThemedText';

/** Mirrors the app's theme context; `fonts={false}` renders children eagerly. */
function ThemeWrapper({ children }: { children: React.ReactNode }) {
  return (
    <BloomThemeProvider colorPreset="blue" fonts={false}>
      {children}
    </BloomThemeProvider>
  );
}

describe('<ThemedText />', () => {
  it('renders its text content', () => {
    render(<ThemedText>Homiio</ThemedText>, { wrapper: ThemeWrapper });
    expect(screen.getByText('Homiio')).toBeTruthy();
  });

  it('renders each typographic variant without crashing', () => {
    const variants = ['default', 'title', 'subtitle', 'defaultSemiBold', 'link'] as const;
    for (const type of variants) {
      const { unmount } = render(<ThemedText type={type}>{`${type} copy`}</ThemedText>, {
        wrapper: ThemeWrapper,
      });
      expect(screen.getByText(`${type} copy`)).toBeTruthy();
      unmount();
    }
  });

  it('forwards arbitrary Text props such as testID', () => {
    render(<ThemedText testID="greeting">Hola</ThemedText>, { wrapper: ThemeWrapper });
    expect(screen.getByTestId('greeting')).toBeTruthy();
  });
});
