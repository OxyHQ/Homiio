# Homiio

## Custom Agents

Use this agent for all implementation work:
- `homiio` — Full-stack engineer (Expo/RN + Stripe + PostHog + Oxy)

## Commands

```bash
bun run dev                 # All packages dev mode
bun run dev:frontend        # Frontend only (Expo tunnel)
bun run dev:backend         # Backend only (nodemon + ts-node)
bun run build               # Build all
bun run build:shared-types  # Shared types only
bun run build:frontend      # Frontend web export
bun run build:backend       # Backend TypeScript compilation
bun run test                # Test all
bun run lint                # Lint all
bun run clean               # Clean everything
```

## Architecture

Monorepo (v2.0.0) — real estate platform.

```
packages/
  frontend/       @homiio/frontend      Expo 55 / React Native 0.83 / React 19
  backend/        @homiio/backend       Express 4.21 / Mongoose 8.17 / Stripe / Sharp
  shared-types/   @homiio/shared-types  Types: address, city, lease, profile, property, review
```

## Key Features

- **Properties**: Listings, search, saved, viewings
- **Payments**: Stripe 16.11 (billing, subscriptions)
- **Analytics**: PostHog integration
- **AI**: @ai-sdk/openai for smart features
- **Location**: expo-location for geolocation
- **Messaging**: Telegram + WhatsApp integrations
- **Media**: Image processing (Sharp), AWS S3 storage
- **i18n**: i18next with locales

## Routes

**Frontend**: addresses, contracts, horizon, insights, profile, properties, reviews, roommates, saved, search, settings, sindi, tips, viewings

**Backend**: addresses, ai, analytics, billing, cities, images, leases, notifications, profiles, properties, public, reviews, roommates, rooms, scraper, telegram, tips, viewings

## Dependencies

- `@oxyhq/core` (1.11.4), `@oxyhq/services` (6.9.12) — Oxy platform integration

## Frontend Gotchas

### NativeWind v4 breaks `Pressable` function-form `style`
NativeWind v4 (`react-native-css-interop`, wired via `nativewind/babel`) rewrites
the `style` prop of every JSX element to merge `className`-derived styles. It does
**NOT support React Native's function form** `style={({ pressed }) => [...]}` — the
function is swallowed and the `Pressable`/`Touchable` renders with **no style at
all** (no `flex`, no `backgroundColor`, no width/height). The children (Text/Icon)
still render with their own styles, which masks the bug.

**Fix:** use a static style array (css-interop merges arrays fine) and drive the
pressed/hovered visual with `onPressIn`/`onPressOut` + `useState`:

```tsx
const [pressed, setPressed] = useState(false);
<Pressable
  onPressIn={() => setPressed(true)}
  onPressOut={() => setPressed(false)}
  style={[styles.x, pressed && styles.xPressed]} // cond && style is valid + typed in RN arrays
>
```

- If the function only returned a base style (no pressed branch), use the static
  style directly: `style={styles.x}` — no state needed.
- For web hover (`({ pressed, hovered }) =>`), keep hovered via `onHoverIn`/`onHoverOut` + state.
- Hooks can't run inside `.map()`, so when a function-form `Pressable` lives in a
  map, extract a small row/button component that owns its own `useState`.
- Canonical template: `packages/frontend/components/search/SearchSummaryBar.tsx`
  (`PillColumn` + `searchButton`).
- Audit: `grep -rn "style={({" app components --include=*.tsx` must return ZERO
  (outside the explanatory comment in `SearchSummaryBar.tsx`).
