# Homiio — Real Estate Platform

Expo/RN frontend + Express backend. Agent: `homiio`.

## Deployment

- **Port**: `4000` | **Domain**: `api.homiio.com` | **ECR**: `oxy/homiio`
- Build: `linux/arm64` Dockerfile in `packages/backend/`.

## Commands

```bash
bun run dev                 # All packages dev mode
bun run dev:frontend        # Frontend only (Expo tunnel)
bun run dev:backend         # Backend only
bun run build               # Build all
bun run test                # Test all
bun run lint                # Lint all
bun run clean               # Clean everything
```

## Architecture

```
packages/
  frontend/       @homiio/frontend      Expo 55 / React Native 0.83 / React 19 / NativeWind 4
  backend/        @homiio/backend       Express 4.21 / Mongoose 8.17 / Stripe / Sharp
  shared-types/   @homiio/shared-types  Types: address, city, lease, profile, property, review
```

## Key Features

- **Properties**: Listings, search, saved, viewings
- **Payments**: Stripe 16.11 (billing, subscriptions)
- **AI**: `@ai-sdk/openai` for smart features
- **Location**: `expo-location` for geolocation
- **Messaging**: Telegram + WhatsApp integrations
- **Media**: Image processing (Sharp), AWS S3 storage
- **i18n**: i18next with locales

## Routes

**Frontend**: addresses, contracts, horizon, insights, profile, properties, reviews, roommates, saved, search, settings, sindi, tips, viewings

**Backend**: addresses, ai, analytics, billing, cities, images, leases, notifications, profiles, properties, public, reviews, roommates, rooms, scraper, telegram, tips, viewings

## IDOR Fix (CRITICAL)

Property/room create and update use server-resolved `profileId` + an editable-field whitelist. Never accept raw `profileId` from the request body — the backend resolves it from the authenticated user via `getRequiredOxyUserId`. Do not regress this.

## Backend Client (Pending Migration)

`oxyServices.createLinkedClient({ baseURL })` is the target pattern, but `HttpService` envelope-unwrap (consumers read `.data.data`) currently blocks the migration. Do not add new local token providers or auth interceptors while this is pending.

## NativeWind v4 — `Pressable` Function-Form `style`

NativeWind v4 (`react-native-css-interop`) does NOT support React Native's function-form `style={({ pressed }) => [...]}` — the function is swallowed and the `Pressable` renders with no style at all.

**Fix:** static style array + `onPressIn`/`onPressOut` + `useState`:

```tsx
const [pressed, setPressed] = useState(false);
<Pressable
  onPressIn={() => setPressed(true)}
  onPressOut={() => setPressed(false)}
  style={[styles.x, pressed && styles.xPressed]}
>
```

- For web hover, use `onHoverIn`/`onHoverOut` + state instead of `({ hovered })`.
- Hooks can't run inside `.map()` — extract a small component when a function-form `Pressable` lives in a list.
- Canonical template: `packages/frontend/components/search/SearchSummaryBar.tsx`
- Audit: `grep -rn "style={({" app components --include=*.tsx` must return ZERO.
