---
title: Sindi is an Alia agent
---

# Sindi is an Alia agent

> **Status: accepted design, not shipped yet.** It is bound by Alia ADR 0020 ("Every
> agent is the same agent") and Oxy ADR 0042 ("agent requester ceilings"). Until
> those are accepted and the phases below land, the running system is the one
> [`sindi-actions.md`](./sindi-actions.md) describes. That document is deleted in
> the same change that deletes `routes/ai.ts`.

The owner decided this on 2026-10-16:

- Alia is Homiio's main AI.
- "Ask Sindi" opens **the same dialog**, with Sindi's character, name and greeting.
- Alia can consult Sindi for anything about housing, from any app.
- Sindi loses nothing it can do today.
- Homiio exposes everything through **one capability catalogue**. That catalogue
  serves both Alia's tools and a public MCP.

## The shape

```text
Homiio app ──@alia.onl/sdk (person's Oxy session, person's credits)──▶ Alia
   ▲  host tools (apply_search, open_listing, …)                     │
   │  tool renderers (PropertyCard)                                   │ oxy_homiio__* tools
   └──────────────────────────────────────────────────────────────────┤ capability tickets
                                                                      ▼
                         api.homiio.com/_oxy/mcp  ◀── one catalogue ──▶ mcp.homiio.oxy.so (OAuth, Claude/ChatGPT/…)
```

- **Homiio's backend never calls Alia.** The frontend talks to Alia directly
  through the SDK, the way "Ask Alia" already does (`context/AskAliaContext.tsx`).
- **Sindi is an ordinary public Alia agent** owned by the Homiio project account.
  Its prompt, families, ceiling and feature gates are edited in Alia's agent
  editor. Nothing about it is pinned in this repository except its agent id,
  which the frontend uses to open it.
- **The model decides.** There is no server-side filter extraction, no self-HTTP
  and no `<PROPERTIES_*>` text injected into the prompt. Sindi calls
  `resolvePlace` and `searchListings`, and its UI effects are host tools.

## The catalogue (`packages/backend/capabilities/`)

The catalogue runs in-process, mounted before the body parsers. It is never
mounted on `routes/public.ts`. Handlers call **domain use cases**
(`packages/backend/domain/*`), which the Express controllers call too, so a
route and its tool share one implementation.

**The catalogue covers everything a signed-in person can do in Homiio**, as that
person. Sindi, Alia and any MCP client get the same tools, bounded only by the
agent's configuration: Sindi's ceiling on Homiio is Ver y actuar, plus the
`finance` package with limits for rent payments. No agent asks for approval
(Alia ADR 0020 §3).

167 tools, `capabilities/homiio.catalog.ts` (assembled from
`capabilities/catalog/*`). Each handler (`capabilities/handlers/*`) calls the
domain use case (`domain/*`) the route calls, and returns the route's JSON body
without `success`, `message` and `meta`. Every tool acts on the account root
(`homiio_account`); a write called with an `Idempotency-Key` replays its stored
receipt (`capability_effect_receipts`, 30 days).

| Domain | Read | Act |
|---|---|---|
| Listings | `searchListings`, `findNearbyListings`, `getListing`, `resolvePlace` | `reportListing` |
| Saved | `listSavedHomes`, `listSavedFolders`, `listSavedSearches`, `listHousingAlerts`, `getHousingAlert`, `listRecentlyViewedHomes` | `saveHome`, `unsaveHome`, `updateSavedHomeNotes`, `createSavedFolder`, `updateSavedFolder`, `deleteSavedFolder`, `createSavedSearch`, `updateSavedSearch`, `deleteSavedSearch`, `setSavedSearchAlerts`, `clearRecentlyViewedHomes` |
| Properties and rooms (owner) | `listMyProperties`, `getMyProperty`, `listPropertiesByOwner`, `listRooms`, `getRoom`, `getMyAnalytics`, `getAppStats` | `createProperty`, `updateProperty`, `publishProperty`, `unpublishProperty`, `deleteProperty`, `markPropertyTransacted`, `createRoom`, `updateRoom`, `deleteRoom` |
| Viewings | `listMyViewingRequests`, `listListingViewingRequests`, `getViewingAvailability`, `getViewingWindows` | `requestViewing`, `cancelViewing`, `rescheduleViewing`, `approveViewing`, `declineViewing`, `setViewingWindows` |
| Short stays | `listMyReservations`, `getReservation`, `getListingAvailability` | `createReservation`, `confirmReservation`, `declineReservation`, `cancelReservation` |
| Exchanges | `listMyExchangeRequests`, `getExchangeRequest`, `listExchangeReviews`, `listUserExchangeReviews` | `requestExchange`, `confirmExchange`, `declineExchange`, `cancelExchange`, `completeExchange`, `writeExchangeReview` |
| Applications | `listMyApplications`, `getApplication` | `submitApplication` (documents as base64 through the app's own upload path), `withdrawApplication`, `startReviewingApplication`, `acceptApplication`, `rejectApplication`, `verifyApplicationDocument` |
| Leases | `listMyLeases`, `getLease`, `listLeaseDocuments` | `createLeaseFromApplication` (the only lease creation), `updateLease`, `signLease`, `renewLease`, `terminateLease`, `deleteLease`, `uploadLeaseDocument` |
| Rent ledger | `listMyPayments`, `listLeasePayments`, `getLeaseLedger` | `declareRentPayment`, `confirmRentPayment`, `rejectRentPayment`, `refundRentPayment`, `createLeasePaymentObligation` — `finance`, internal only, idempotency required, a limit key on every amount |
| Maintenance | `listMyMaintenanceRequests`, `getMaintenanceRequest` | `createMaintenanceRequest`, `commentOnMaintenanceRequest`, `transitionMaintenanceRequest` |
| Evictions | `listEvictionCases`, `getEvictionCase`, `listEvictionComments`, `listEvictionResources`, `listMyEvictionCases`, `listAttendingEvictionCases`, `listFollowedEvictionCases`, `getEvictionTeam`, `getExactEvictionLocation`, `listEvictionLocationGrants`, `getEvictionLocationAudit` | `reportEvictionCase`, `updateEvictionCase`, `deleteEvictionCase`, `postEvictionUpdate`, `clearEvictionHold`, `toggleEvictionAttendance`, `toggleEvictionFollow`, `vouchForSupporter`, `revokeSupporter`, `addEvictionCollaborator`, `removeEvictionCollaborator`, `grantEvictionLocation`, `revokeEvictionLocationGrant`, `commentOnEviction`, `deleteEvictionComment`, `reportEvictionContent` |
| Reviews | `listReviews`, `getAddressReviewStats`, `getReview`, `listUserReviews` | `writeReview`, `updateReview`, `deleteReview`, `markReviewHelpful`, `reportReview` |
| Addresses | `searchAddresses`, `findNearbyAddresses`, `getAddress`, `listAddressCorrections` | `createAddress`, `updateAddress`, `proposeAddressCorrection`, `withdrawAddressCorrection` |
| Profile and notifications | `getMyProfile`, `getUserProfile`, `listMyNotifications`, `getNotification` | `updateMyProfile`, `markNotificationRead`, `markAllNotificationsRead`, `deleteNotification`, `clearAllNotifications` |
| Roommates | `listRoommateProfiles`, `getRoommateStatus`, `getRoommatePreferences`, `listRoommateRequests`, `listRoommateRelationships` | `updateRoommatePreferences`, `toggleRoommateMatching`, `sendRoommateRequest`, `acceptRoommateRequest`, `declineRoommateRequest`, `endRoommateRelationship` |
| Partners | `getMyPartnerStatus`, `listMyReferrals`, `getMyPartnerEarnings`, `getMyGuestPoints` | `joinPartnerProgram` |
| Internal only | `readFileEntitlement` | `consumeFileCredit` (the `sindi.files` feature gate) |

**Messages.** Homiio has no person-to-person messaging product
([`messaging-audit.md`](./messaging-audit.md)), so there is no conversation
tool. Reaching an owner is `requestViewing`, `submitApplication`,
`createReservation` or `requestExchange`; Homiio's own Sindi conversations are
replaced by Alia's.

**Rent through Peable** is not connected ([`peable-rent-payments.md`](./peable-rent-payments.md)):
there is no processor and no route, so the payment tools record the ledger and
"set up payments" does not exist yet.

`capabilities/routeCoverage/*` maps every authenticated route to its tool or a
written exclusion, and `routeParity.test.ts` walks the real router and fails on
a route with neither. The exclusions are the Sindi relay (`/api/ai/*`), the
scraper, Telegram operator tooling, Stripe webhook/debug/manual routes, the
Homiio+ purchase pages, MLS team chat, raw image uploads, admin city
maintenance, raw document/attachment/receipt bytes, view tracking, the lease
create route (a lease only comes from an accepted application), the property
test endpoint, and the two notification writes that bypass
`notificationDispatchService`.

**Bump the catalogue `version`** whenever a tool changes: Oxy registers by
(appId, version, digest), and `catalog.test.ts` pins the pair.

**Never in the catalogue** (owner vetoes and binding ADRs, not agent limits):

- admin or moderation tools, scraper tools and the `removed` status — the owner's
  veto in `AGENTS.md`;
- anything under `/search`;
- data at a precision the API would not publish to that person (ADR 0003): a tool
  returns exactly what the same route returns.

Rules the handlers must keep:

- **The effective account** comes from the verified ticket's
  `effectiveAccountId` (internal) or from the OAuth connection's active account
  (external). It never comes from `requireSessionOxyUserId` and never from the
  input. Ownership stays in the repository query, so a non-owner gets
  not-found.
- **Property, lease and application writes** keep their field whitelists
  (`controllers/property/editableFields.ts`, `controllers/lease/editableFields.ts`)
  and a lease is only ever created from an accepted application, as
  `/contracts/new?application=<id>` is the only lease entry point in the UI.
- **Re-marking a property transacted** stays idempotent (`onPropertyTransacted`).
- **`requestViewing` on an `isExternal` listing** returns
  `external_listing { sourceUrl }`. It is never routed to an enquiry flow, and a
  contact is never invented.
- **Notifications** go only through `services/notificationDispatchService.ts`.
- **Reports** are community `reports[]` only.

## What Sindi does today, and where it goes

| Today | Then |
|---|---|
| `/api/ai/stream` relay, Vercel data stream | SDK `AliaChatContent agent={sindi}` → Alia `/v1/chat/completions` |
| `extractFiltersWithAI` + internal HTTP to `/api/properties/*` | `resolvePlace` → `searchListings` / `findNearbyListings` / `getListing` |
| `<PROPERTIES_HINTS>` / `<PROPERTIES_CONTEXT>` system text | structured tool output |
| `<PROPERTIES_JSON>` + `PropertiesFromIds` | tool renderer `homiio:searchListings` → `PropertyCard` |
| server-derived `SindiActionEnvelope` | host tools `host_homiio__*`, the same `SindiAction` union (`packages/shared-types/src/sindiAction.ts`) and executor (`hooks/useSindiActions.ts`) |
| `clarify_location` | `resolvePlace` answers `ambiguous` / `not_found` → host tool, same inline card |
| `wantsListings` (asking ≠ navigating) | Sindi's prompt plus the host tool's description, covered by a 12-locale eval |
| `appContext` revision, stale turns | `host.context` per turn; the executor keeps its rules |
| host act modes (`components/sindi/sindiHost.ts`) | unchanged |
| PDF contract review, housing image analysis | Alia `file` / `image_url` parts plus Sindi's prompt |
| Homiio+ file gate (client-only today; credits never spent) | feature gate `sindi.files`, enforced and consumed on the server; locked → `FilePremiumInfoSheet` |
| Homiio conversation tables, titles, 24 h share links | Alia conversations (`?agentId=`), titles and share links. **Existing Homiio conversations are deleted, not migrated.** |
| `/ai/suggestions` | Alia `/v1/suggestions/welcome { agentId, clientContext }` |
| docked/overlay panel, `/sindi` screens, property sheet | the SDK's components on the same surfaces |
| "Ask Sindi about this home", sidebar entries | `useAskAgent().ask('sindi', turn)`, one sheet for Alia and Sindi |
| voice dictation | the SDK's voice |

**New:**

- every action a person can take in Homiio, fully autonomous within Sindi's
  configuration, with no approval cards;
- Alia consulting Sindi from any app (Sindi joins the conversation with Bloom's
  avatar flight);
- Homiio's public MCP.

## Phases in this repository

Each phase ships as a PR to `main` with auto-merge, and the frontend never ships
while a backend deploy is failing. Nothing old is kept: each cut deletes what it
replaces in the same change.

1. **Backend expand:**
   - domain use cases (no behaviour change);
   - `capabilities/*`;
   - `capability_effect_receipts` (`pre`, with an `EXPIRY_SWEEP_TARGETS`
     entry);
   - registration at startup;
   - both MCP mounts.

   This needs `mcp.homiio.oxy.so` in oxy-infra and the workload re-bound with
   the catalogue scopes. The precedent is Mercaria's in-process
   `src/capabilities/*`.
2. **Frontend** (same PR as phase 3):
   - `@alia.onl/sdk` 19 and `AliaAskProvider`;
   - host tools from `useSindiActions` / `useSindiAppContext`;
   - renderers;
   - the SDK on every Sindi surface;
   - delete Homiio's own chat components, hooks, store and unused `sindi.*` keys.
3. **The cut, in one change with the frontend:**
   - delete `routes/ai.ts` (no 410 handler, no compatibility window; old native
     binaries get 404 until they update) together with `aliaChatService`,
     `oxyInferenceService`, `sindiActions` (server), `chatTags`,
     `db/conversations/*` and `/ai/shared/:token`;
   - remove the `conversations.sharingExpiresAt` entry in `db/expiry.ts`;
   - a `post` migration drops `conversation_message_attachments`,
     `conversation_messages`, `conversations` and `profile_chat_messages`;
   - `deploy-aws.yml` drops `SINDI_ALIA_AGENT_ID`,
     `OXY_INFERENCE_ROUTING_PROFILE_ID` and `ALIA_API_URL` (they are added to
     `TASK_CONFIGURATION_REMOVALS_JSON`);
   - `AGENTS.md` loses the Sindi streaming-fetch exception;
   - this page replaces `sindi-actions.md`.
