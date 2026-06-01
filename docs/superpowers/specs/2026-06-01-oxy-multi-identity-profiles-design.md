# Multi-Identity Profiles: Oxy-owned identity + Homiio real-estate sidecar

**Date:** 2026-06-01
**Status:** Design / awaiting review
**Repos affected:** OxyHQServices (`packages/api`, `packages/core`, `packages/services`, auth) + Homiio (`packages/backend`, `packages/frontend`, `packages/shared-types`)

## Goal

Let one person operate multiple identities — their personal account plus one or more
real-estate **business** identities (e.g. an agency in Madrid, another in Barcelona) —
and **publish as the chosen identity** instead of always as their personal profile.
Stop maintaining Homiio's own parallel profile system; use OxyServices' identity system
as the single source of truth and improve it where it falls short.

Mental model the user asked for: **"like Google"** — a personal account plus business
accounts you switch between. This maps almost exactly to Google/YouTube **Brand Accounts**:
one login owns multiple brand identities, switches between them, and adds other people as
managers with roles.

## Decisions (locked with user)

- **Architecture A** — Oxy owns 100% of identity; Homiio keeps only a thin real-estate-data
  record per Oxy identity. (Rejected: B = hybrid mirror with two sources of truth; C = push
  real-estate fields into Oxy.)
- **Account types** — personal vs business, first-class on the Oxy `User`, like Google.
  Business identities are created **self-serve** (instant). A "verified agency" badge is a
  later layer granted after credential review, not a gate on creation.
- **Teams: now** — agencies can have multiple human members (several agents), with an
  invite/accept flow and roles.
- **Attribution: whole footprint** — while acting as an agency, everything created
  (listings, reviews, viewings, messages, contracts) is attributed to the agency.
- **Greenfield** — no real production data to migrate; redesign cleanly, no migration script.

---

## Review findings (current state)

### OxyServices API (`packages/api`)
- **No separate Profile entity.** "Profile" is a public projection of a `User` document
  (`routes/profiles.ts` is read-only views over `User`). Account == Profile == one `User`.
- Multi-identity primitive that exists: **Managed Accounts** — a sub-account is a full `User`
  doc, linked via the `ManagedAccount` join collection (`models/ManagedAccount.ts`) with
  `ownerId` (one) + `managers[]` (many, roles `owner|admin|editor`). One owner → many
  sub-accounts. Endpoints under `/managed-accounts` (`routes/managedAccounts.ts`).
- **No account/profile type taxonomy.** `User.type` is origin only (`local|federated|agent|automated`,
  `models/User.ts`). Nothing marks "business"/"agency" vs "personal".
- **Acting-as is NOT enforced server-side (critical gap).** The SDK sends an `X-Acting-As`
  header (`core/src/HttpService.ts:380-382`) but **no API middleware reads it**
  (`middleware/auth.ts` only resolves the session user). Tokens are not profile-scoped
  (`utils/sessionUtils.ts` payload = `{userId, sessionId, deviceId, type}`); `Session`
  (`models/Session.ts`) has no active-profile field; there is no switch endpoint. So today
  "publish as agency" silently writes as the personal account.
- **Broken client/server contract:** core SDK calls `GET /internal/service-acting-as/verify`
  and expects a `ServiceActingAs` model — neither exists in `packages/api`.
- Member roles exist but **no invite/accept flow** (`addManager` takes a raw userId); `editor`
  can't update at all. Latent `userCache.invalidate()` gap on managed-account writes
  (`services/managedAccount.service.ts`).

### OxyServices SDK (`packages/core`, `packages/services`)
- No `Profile`/`Identity` type; "Profile" == `User` (`core/src/models/interfaces.ts`).
- Two unreconciled switch mechanisms:
  - `switchSession(sessionId)` — multi-login; **swaps the bearer token** and clears query cache.
  - `setActingAs(userId)` — managed accounts; **header only, same token, NO cache invalidation**
    (`services/.../OxyContext.tsx`), so data goes stale after a switch.
- `useOxy()` already exposes `actingAs`, `managedAccounts`, `setActingAs`, `createManagedAccount`,
  `refreshManagedAccounts`. UI already exists: `AccountSwitcherScreen`, `CreateManagedAccountScreen`,
  `ActingAsBanner`.
- Gaps: no profile-kind discriminator in types; `setActingAs` doesn't invalidate caches; no
  `getEffectiveUserId()` / `useActiveIdentity()` / `getActingAsUser()`; session-keyed account
  store has zero managed-account awareness; no managed-account mutation hooks.

### Homiio (current — a parallel duplicate)
- Own `Profile` model (`packages/backend/models/schemas/ProfileSchema.ts`, ~1065 lines) keyed by
  `oxyUserId`, with `profileType` (`personal|agency|business|cooperative`), `isActive`/`isPrimary`
  (unique-active partial index → exactly one active profile per user), embedded
  personal/agency/business/cooperative sub-schemas, agency/cooperative `members[]` + roles,
  trust-score engine, and a `pre-save` that deactivates all other profiles on activate.
- **`Property.profileId` → Homiio `Profile._id`** (`PropertySchema.ts:246-251`), and the same FK
  appears across ~12 collections (Review, Lease, Reservation, Saved, SavedSearch,
  SavedPropertyFolder, RecentlyViewed, Conversation, ExchangeRequest, ExchangeReview,
  TenantApplication). This is the central structural constraint.
- On create (`controllers/property/create.ts`), the server stamps the caller's **active** Homiio
  profile as `profileId` — there is no per-listing choice of publishing identity.
- Identity hacks that exist only because Homiio's Profile has no real identity fields:
  fake handle `@${_id.slice(-6)}` (`profile/[profileId].tsx`), hardcoded
  `cdn.oxy.so/avatars/${oxyUserId}` and bio-as-name fallback (`components/property/LandlordSection.tsx`).
- Agency "team" UI is non-functional (the "Add Team Member" button has no handler).

**Duplicates Oxy (remove):** active-profile switching, agency/cooperative members+roles,
identity display fields (avatar/name/handle/legalName-as-name), profile-visibility settings,
save/follow-profile, auto-create-default-personal dance, dual `useProfile`/`useProfileQueries`
client scaffolding.

**Real-estate data that must stay in Homiio:** trust score + `calculateTrustScore()` engine,
tenant verification flags, rental history, references, tenant income/employment/move-in,
property search preferences, roommate-matching prefs + history, agency real-estate credentials
(license #, taxId, specialties, service areas, business verification, ratings), listing
notification prefs, Sindi chat history, and the owner FK joinability across ~12 collections.

---

## Target architecture

### Principles & layering

| Layer | Owner | Holds |
|---|---|---|
| **Identity** (who you publish *as*) | **Oxy** | username, name, avatar, handle, `accountType` (personal/business), team membership + roles + invites, the acting-as switch |
| **Real-estate data** | **Homiio** | trust score, verification, rental history, references, tenant income, search prefs, roommate, agency credentials, Sindi chat |

- A **business identity** = an Oxy *managed account* with `accountType='business'`, owned by a
  person, operable by team members with roles.
- One person owns **many** business identities (Oxy already supports one-owner → many).
- **"Acting as"** is the only switch. `effectiveUserId = activeProfileId ?? userId`, resolved and
  **enforced server-side**.
- Homiio stores **one thin `Profile` per Oxy identity**, keyed unique by `oxyUserId`.
  No identity fields, no profile-types-as-identity, no `isActive`/`isPrimary`, no `members[]`.
- **Whole-footprint attribution:** every Homiio write attaches to the effective identity's
  `Profile`.

### Section 1 — Oxy identity data model

- Add **`User.accountType: 'personal' | 'business'`** (default `'personal'`; reserve room for
  `'organization'`). Distinct from the existing origin `User.type` enum, which is untouched.
- Business identities created **self-serve** (instant). Generic business identity fields on Oxy:
  `legalName?`, `website?`, `verified` (badge flag). Real-estate-specific credentials do **not**
  live here — they stay in Homiio.
- Extend `CreateManagedAccountInput` with `accountType` + optional generic business metadata.
- **Teams:** build on `ManagedAccount.managers[]`. Roles:
  - **owner** — full control, incl. delete account + grant owner.
  - **admin** — manage listings + members; cannot delete account or grant owner.
  - **member** (agent) — publish & manage as the agency; no settings/member control.
- **Invite flow (new):** invite by email/username → `pending` membership → accept/decline.
  Replaces raw `addManager(userId)`. Add a `MemberInvite` concept + pending state.
- Fix the `userCache.invalidate()` gap on managed-account writes.

### Section 2 — Acting-as enforcement (security core)

Chosen mechanism: **session/token-scoped active profile** (not header-only).

- New switch endpoint (e.g. `POST /managed-accounts/:id/activate` and a deactivate/`/sessions/active-profile`)
  verifies membership via the existing `verifyActingAs`/`getManagerRole`, then records
  `activeProfileId` on the **Session** (and/or adds an `actingAs` claim to the issued token).
- Auth middleware resolves **`effectiveUserId = session.activeProfileId ?? session.userId`** and
  exposes it (e.g. `req.effectiveUser` / `req.effectiveUserId`).
- `GET /users/me` and token introspection return `{ userId, actingAsId, effectiveUserId, accountType }`.
- **Homiio's backend gets the effective identity for free** — it validates the same Oxy token via
  Oxy and reads `effectiveUserId` from introspection. One source of truth across both backends;
  no raw-header trust; survives page reload.
- Writes attributed to `effectiveUserId`; "my stuff" reads scope to it.
- Switching **invalidates caches** (HTTP + TanStack), mirroring `switchSession`.
- The `X-Acting-As` header path may remain as compat, but the session-scoped value is authoritative.

**Guardrails:** activate a profile you're not a member of → 403; personal = `activeProfileId` null;
membership revoked while active → re-verify per request, fall back to personal (+ 403 on the agency
resource). Implement/retire the missing `/internal/service-acting-as/verify` contract.

### Section 3 — Oxy SDK surface

**`@oxyhq/core`:**
- Types: `accountType` on `User`; `ManagedAccount` gains type + generic business metadata + pending
  invites; new `MemberInvite` type.
- `getEffectiveUserId(): string` — canonical attribution id (`actingAs ?? currentUserId`).
- `getActingAsUser(): Promise<User>` — resolves the active identity's user.
- `switchProfile(accountId | null)` — calls the activate endpoint, updates session active profile,
  clears HTTP cache, returns the effective user.
- Invite methods: `inviteMember(accountId, {email|username, role})`, `listInvites`, `acceptInvite`,
  `declineInvite`, `removeMember`.

**`@oxyhq/services` (RN SDK):**
- `useActiveIdentity()` → `{ identity, accountType, isActingAs }`, own query key (no collision with
  `useCurrentUser`).
- `useIdentities()` → all switchable identities (personal + business), each `kind`-tagged.
- Mutation hooks with invalidation: `useSwitchProfile`, `useCreateBusinessAccount`, `useInviteMember`,
  `useAcceptInvite`, `useRemoveMember`, etc.
- UI: extend `AccountSwitcherScreen` (account type + business badge), `CreateManagedAccountScreen`
  (type + business fields), add team-management + invite screens; `ActingAsBanner` already exists.

### Section 4 — Homiio sidecar data model

- Redefine Homiio `Profile` into a **thin per-identity real-estate record**, one per Oxy identity,
  unique by `oxyUserId`. Keep the model name `Profile` so the existing `profileId` FKs stay valid.
- **Drop:** `profileType`-as-identity, `isActive`/`isPrimary`, `members[]`, avatar/name/handle/
  legalName-as-name, save/follow-profile, auto-create-default dance.
- **Keep (real-estate only):** trustScore + engine, verification flags, rentalHistory, references,
  tenant `personalInfo` (income/employment/move-in), `preferences`, roommate settings, notification
  prefs, Sindi `chatHistory`, agency credentials (license, taxId, specialties, serviceAreas, business
  verification, ratings).
- `identityKind` denormalized from Oxy `accountType` (source of truth = Oxy; cached). One schema
  carries both tenant and agency sub-objects, each optional; UI gates by `identityKind`.
- `findOrCreateByOxyUserId(effectiveUserId)` — lazily created on first need.
- `Property.profileId` + the ~11 sibling FKs → point at `Profile._id`. Greenfield → clean
  re-seed, no migration script. (Keeping a thin record rather than re-keying every collection to
  `oxyUserId` preserves all existing joins with least churn.)

### Section 5 — Homiio integration

- Homiio auth middleware reads `effectiveUserId` from Oxy introspection →
  `resolveProfile(effectiveUserId)`; replaces "find active Homiio profile".
- `controllers/property/create.ts` and every write path attribute to
  `resolveProfile(effectiveUserId)._id` → whole-footprint attribution falls out naturally.
- Owner/landlord display reads name/avatar/handle from the Oxy `User` (via SDK); delete the
  `cdn.oxy.so/avatars/...` shim, `@${_id.slice(-6)}` fake handle, and bio-as-name fallback.
- Homiio profile switcher → Oxy `useIdentities()` + `useSwitchProfile()` (or the Oxy
  `AccountSwitcherScreen`); delete Homiio's activation UI.
- Agency credential editing (license etc.) stays in Homiio, attached to the business identity's
  `Profile`; verifying credentials can flip the Oxy `verified` badge.
- Delete duplicated client scaffolding (dual `useProfile`, `useProfileQueries`, profileStore
  identity bits).

---

## Phasing (build order)

Dependency-ordered; each upstream phase is built, tested, and published before the downstream
consumes it (Fix Upstream rule).

1. **Oxy foundation** (`oxy-api`, `oxy-auth`): `accountType`; acting-as enforcement
   (session-scoped active profile + introspection surfacing `effectiveUserId`); switch/activate
   endpoint; cache-invalidation contract; `userCache` fix; resolve the missing service-acting-as
   contract. *Security-critical — everything depends on it.*
2. **Oxy teams** (`oxy-api`): invite/accept flow, roles, pending membership.
3. **Oxy SDK** (`oxy-core`, `oxy-services`): types, `getEffectiveUserId`, `useActiveIdentity`/
   `useIdentities`, `switchProfile` + cache invalidation, mutation hooks, switcher/create/team UI.
4. **Homiio** (`homiio`): `Profile` redefinition, effective-identity resolution, attribution
   rewrite, Oxy-sourced owner display, switcher swap, agency credential UI, delete duplication.

---

## Error handling & edge cases

- Activate a profile you're not a member of → **403** everywhere (single `verifyActingAs`).
- Membership revoked mid-session → re-verify per request, fall back to personal.
- Stale cache after switch → forced HTTP + query invalidation (regression test).
- Personal-only RE fields on a business identity (and vice-versa) → schema allows both; UI gates by
  `identityKind`.
- Delete a business account that still has listings → **block** until listings removed/transferred.
- Old clients without an `actingAs` claim → behave as personal (backward compatible).

## Testing

- Oxy: acting-as enforcement middleware unit tests (member / non-member / revoked); switch-endpoint
  integration; invite/accept flow.
- SDK: `getEffectiveUserId` correctness; cache-invalidation-on-switch regression.
- Homiio: attribution tests (create while acting as agency → record lands on the agency's
  `Profile`); owner-display reads from Oxy.
- End-to-end: create a Madrid agency → switch to it → publish a listing → it appears under the
  agency, not the personal account; add a second agent via invite → they can publish as the agency.

## Out of scope (YAGNI for now)

- `'organization'` account type beyond reserving the enum value.
- Capability-level permissions finer than the three roles.
- Migration tooling (greenfield).
- Cross-app identity features beyond what Homiio needs.
