# Homiio

## AWS Deployment

The backend runs on **AWS ECS Fargate** (region `us-west-2`, cluster `oxy-cluster`), behind an ALB with ACM HTTPS.

- **Port**: `4000` | **Domain**: `api.homiio.com`
- **Deploy**: `git push origin main` → `.github/workflows/deploy-aws.yml` builds a `linux/arm64` Docker image → pushes to ECR (`237343248947.dkr.ecr.us-west-2.amazonaws.com/oxy/homiio`) → `aws ecs update-service --force-new-deployment`
- **Auth**: GitHub OIDC → role `oxy-github-deploy`. No AWS keys stored in GitHub.
- **Secrets**: GitHub Actions secrets are the source of truth. The deploy workflow syncs them to AWS SSM (`/oxy/homiio/*`; shared secrets to `/oxy/_shared/*`); ECS injects them into the container. To change a secret: edit it in GitHub — the next deploy applies it.
- **Dockerfile**: must build for `linux/arm64` (Graviton).
- **WARNING**: Never put secret values in this file.

## Custom Agents

Use this agent for all implementation work:
- `homiio` — Full-stack engineer (Expo/RN + Stripe + Oxy)

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
- **AI**: @ai-sdk/openai for smart features
- **Location**: expo-location for geolocation
- **Messaging**: Telegram + WhatsApp integrations
- **Media**: Image processing (Sharp), AWS S3 storage
- **i18n**: i18next with locales

## Routes

**Frontend**: addresses, contracts, horizon, insights, profile, properties, reviews, roommates, saved, search, settings, sindi, tips, viewings

**Backend**: addresses, ai, analytics, billing, cities, images, leases, notifications, profiles, properties, public, reviews, roommates, rooms, scraper, telegram, tips, viewings

## Oxy SDK Conventions

- **Versions**: `@oxyhq/core ^3.10.0`, `@oxyhq/services ^11.0.0`, `@oxyhq/bloom ^0.19.1`, `@oxyhq/contracts ^0.2.1` (transitive via core). `@oxyhq/services ^11.0.0` is a packaging-only major — deps moved to peerDependencies; app must declare TanStack Query peers.
- **Media**: avatars/images resolve ONLY through `oxyServices.getFileDownloadUrl(id, variant)` via `useOxyAvatars` (`getUsersByIds` → `getFileDownloadUrl`) + bloom's variant-aware `<Avatar source={fileId} variant="thumb">`. Do NOT use `cdn.oxy.so` URLs directly — that pattern was removed.
- **Display names**: render `name.displayName` directly (core 3.10 fixes the type under node resolution). No local name fallbacks.
- **Backend auth**: `@oxyhq/core/server` only — `createOxyAuthMiddleware`/`getRequiredOxyUserId`/`authSocket`. No local auth middleware.
- **IDOR fix (CRITICAL)**: property/room create and update use server-resolved `profileId` + an editable-field whitelist. Never accept raw `profileId` from the request body — the backend resolves it from the authenticated user. Do not regress this.
- **Backend client (flagged follow-up)**: `oxyServices.createLinkedClient({ baseURL })` is the target pattern, but `HttpService` envelope-unwrap (consumers read `.data.data`) currently blocks the migration. Do not add new local token providers or auth interceptors while this is pending.

## Dependencies

- `@oxyhq/core ^3.10.0`, `@oxyhq/services ^11.0.0`, `@oxyhq/bloom ^0.19.1` — Oxy platform integration
- Frontend `packages/frontend/app/+html.tsx` injects `getSsoCallbackBootstrapScript()` from `@oxyhq/core`; do not add per-app `/__oxy/sso-callback` routes or local SSO helper copies.
- Frontend auth/session state belongs to `OxyProvider` with a registered `clientId`; SDK cold boot owns callback consumption, stored-session restore, FedCM/silent restore, and SSO bounce.
- Backend auth middleware comes from `@oxyhq/core/server` (`createOxyAuthMiddleware`, `createOptionalOxyAuth`, `createOxyRateLimit`, `requireOxyAuth`, `getRequiredOxyUserId`, `authSocket`). Do not define local `AuthRequest`, `requireAuth`, `getUserId`, bearer parsers, or token-decoding middleware. Bearer-authenticated writes do not fetch app-local CSRF tokens; CSRF remains for ambient cookie credentials.

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
