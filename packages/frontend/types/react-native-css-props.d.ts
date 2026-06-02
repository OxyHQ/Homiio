/**
 * Forward-compat typing for React Native's cross-platform `textShadow` style prop.
 *
 * React Native 0.85 (and React Native Web) added the CSS-style `textShadow`
 * string prop at runtime and DEPRECATED the discrete `textShadow*` props
 * (`textShadowColor` / `textShadowOffset` / `textShadowRadius`) — the runtime
 * even logs `'"textShadow*" style props are deprecated. Use "textShadow".'`.
 * However, `react-native@0.85.3`'s bundled TypeScript defs still only declare the
 * deprecated trio on `TextStyle` and have not yet added the replacement
 * `textShadow` string prop.
 *
 * This declaration-merges the missing, RUNTIME-SUPPORTED prop onto RN's
 * `TextStyle` so the app can adopt the non-deprecated API with full type safety
 * (no `as any`, no `@ts-ignore`). `boxShadow` already ships in RN 0.85's
 * `ViewStyle`, so only `textShadow` needs to be added here.
 *
 * When a future React Native release publishes `textShadow` in its own types,
 * this identical declaration merges harmlessly; a type change upstream would
 * surface as a compile error here, which is the desired signal to drop this file.
 */
import 'react-native';

declare module 'react-native' {
  interface TextStyle {
    /**
     * Cross-platform text shadow, e.g. `'0px 1px 4px rgba(0,0,0,0.35)'`.
     * Replacement for the deprecated `textShadowColor` / `textShadowOffset` /
     * `textShadowRadius` props. Build it with `textShadow()` from
     * `@/styles/shadows`.
     */
    textShadow?: string | undefined;
  }
}
