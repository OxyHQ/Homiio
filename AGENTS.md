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

## Dependencies

- `@oxyhq/core` (^3.4.13), `@oxyhq/services` (^10.2.10), `@oxyhq/bloom` (^0.8.5) — Oxy platform integration
- Frontend `packages/frontend/app/+html.tsx` injects `getSsoCallbackBootstrapScript()` from `@oxyhq/core`; do not add per-app `/__oxy/sso-callback` routes or local SSO helper copies.
- Frontend auth/session state belongs to `OxyProvider` with a registered `clientId`; SDK cold boot owns callback consumption, stored-session restore, FedCM/silent restore, and SSO bounce.
- App backend clients must use `oxyServices.createLinkedClient({ baseURL })`. Do not add local token providers, auth interceptors, manual `Authorization` plumbing, refresh retries, or session invalidation.
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
