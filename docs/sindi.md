---
title: Sindi is an Alia agent
---

# Sindi is an Alia agent

Bound by Alia ADR 0020 ("Every agent is the same agent") and Oxy ADR 0042
("agent requester ceilings"). The owner decided this on 2026-10-16:

- Alia is Homiio's main AI ("Ask Alia").
- "Ask Sindi" opens **the same dialog**, with Sindi's character, name and greeting.
- Alia can consult Sindi for anything about housing, from any app.
- Sindi loses nothing it could do before.
- Homiio exposes everything through **one capability catalogue**. That catalogue
  serves both Alia's tools and a public MCP.

## The shape

```text
Homiio app ──@alia.onl/sdk (person's Oxy session, person's credits)──▶ Alia
   ▲  host tools (host_homiio__apply_search, …)                       │
   │  tool renderers (PropertyCard, saved homes, place clarification) │ oxy_homiio__* tools
   └──────────────────────────────────────────────────────────────────┤ capability tickets
                                                                      ▼
                         api.homiio.com/_oxy/mcp  ◀── one catalogue ──▶ mcp.homiio.com (OAuth, Claude/ChatGPT/…)
```

- **Homiio's backend never calls Alia.** Sindi and Alia are reached from the
  frontend through `@alia.onl/sdk` under the person's Oxy session. The backend
  has no chat route, no conversation table and no inference client; it serves
  the catalogue.
- **Sindi is an ordinary public Alia agent** owned by the Homiio project account.
  Its prompt, families, ceiling and feature gates are edited in Alia's agent
  editor. The only thing pinned in this repository is its agent id
  (`components/sindi/sindiAgent.ts`).
- **The model decides.** There is no server-side filter extraction, no self-HTTP
  and no text injected into the prompt. Sindi calls `resolvePlace` and
  `searchListings`, and its effects on the screen are host tools.

## Where it is in the app

| Surface | File | Host | What acting on the app means |
|---|---|---|---|
| "Ask Alia" and "Ask Sindi": one sheet | `context/AskAgentProvider.tsx` (`AliaAskProvider`) | `sheet` | nothing moves: the sheet floats over a page the person chose to read; the answer stays in the conversation |
| Docked panel (≥ 1024) | `components/sindi/SindiPanel.tsx`, `AppShell`'s `aside` | `panel` | `beside`: the page column navigates, the chat stays |
| Overlay panel (500–1023) | same, through Bloom's Portal | `panel` | `reveal`: the page navigates under it, and the panel closes once the answer is written |
| Full-screen chat | `app/(tabs)/sindi/[conversationId].tsx` (`/sindi/new` for a new one) | `screen` | `leave`: the destination takes the screen once the answer is written |
| Conversation list | `app/(tabs)/sindi/index.tsx`, the panel's landing | — | `useConversations({ agentId })` |
| Shared conversation | `app/(tabs)/sindi/shared/[token].tsx` | — | `AliaSharedConversation`, read-only, no session |
| Settings | `app/settings/sindi.tsx` | — | tips on/off (`store/sindiPreferencesStore.ts`); reset deletes Sindi's conversations through the SDK |

Entry points: the sidebar's "Ask Alia" action and the phone bottom bar's Alia
button are `useAskAgent().ask('alia')`; the sidebar's Sindi row opens `/sindi`
at every width (#678 — nothing in the shell toggles the panel any more; it shows
only while `uiStore.sindiPanelOpen` is set);
"Ask Sindi about this home" (`components/property/SindiSection.tsx`) is
`ask('sindi', turn)` with the listing named in the turn.

`hooks/useSindiChat.ts` builds what every surface hands the SDK, per host: the
host tools and the executor, the screen's context, the renderers, the chat's
words from Homiio's i18n, the Homiio+ upsell and the share link. The panel and
the full-screen chat mount it through `components/sindi/SindiConversation.tsx`
(`AliaChatContent agent={sindi}`).

## Host tools: what Sindi may do to the screen

Five intents, `shared-types/sindiAction.ts#SINDI_HOST_TOOLS`. Each tool's JSON
Schema and its parser are built from **one field table**, so what the model is
told it may send and what the client accepts cannot drift. The union is closed:
a sixth intent is a reviewed edit to that file. **Nothing here writes** — a
write is a catalogue tool, authorised by Oxy for the person present; a host tool
is never authority over data.

| Tool (`host_homiio__…`) | Payload | Executed as |
|---|---|---|
| `apply_search` | a **patch** over the live query | the canonical pipeline → one navigation to `exploreHref(next)` |
| `show_saved` | an optional collection id | `/saved` or `/saved/[folderId]`, under the person's own session |
| `open_listing` | one listing id | the listing route |
| `set_results_view` | `list` \| `map` | `store/exploreViewStore.ts`; Explore comes with it unless the docked panel is beside it |
| `navigate` | one **enumerated** destination | the router's own path table (`DESTINATION_ROUTES`) |

There is no `eval`, no generated JavaScript, no DOM click, no arbitrary URL and
no API method chosen by a model: `navigate` takes a destination from a
five-member enum rather than a path, because a path is a string and a string is
an open door.

Alia records the call, answers the model `{ status: 'dispatched' }` and emits
`alia.host_action` to the client that declared it. The executor
(`hooks/useSindiActions.ts`) answers one outcome, which the SDK sends with the
next request and the model reads as that call's result:

| Outcome | When |
|---|---|
| `applied` | the app now shows it |
| `inline` | the host cannot show a result (the sheet); nothing moved |
| `rejected` | the input is outside the contract (`parseSindiHostCall` answers null) |
| `stale` | the person changed the search by hand during the turn — their change wins (#519 §8.8). The query's revision is taken when the turn is SENT (`runtime.onTurnStart`) and compared when the action arrives |
| `failed` | `exploreHref` cannot carry the area (a polygon, an unencodable id): navigating anyway would answer globally under a local heading (ADR 0002 §4.3) |

The refusals the old data channel needed are structural now: the SDK performs a
call once per `toolCallId`, Stop aborts the stream that would carry a late call,
and a stored or shared conversation carries no `alia.host_action` at all — so
history executes nothing.

### Two halves, at two times

A call arrives MID-STREAM: the model asks for the effect and keeps writing.
`reveal` and `leave` both end with the chat's own surface gone, and doing that
on arrival unmounts a chat that is still streaming. So the executor applies the
STATE half at once (the search query, the results view) and holds the half that
removes the chat until the SDK's conversation store says the stream stopped
(`streamingConversationId` leaving the conversation that was streaming) — after
Stop as much as after the last word. `beside` holds nothing. A surface that
unmounts first takes its held steps with it.

### `apply_search` is a patch

Absent keys leave the live query alone, so *"ahora con dos habitaciones y que
admitan mascotas"* keeps the area and the budget. `location` **replaces**
rather than merges, because a geographic selection is atomic (ADR 0002 §3). The
offering is applied **first**, because switching it clears the price range (a
monthly rent is not a nightly rate).

**A price carries no currency.** *"Under 1,200"* names an amount and not a unit,
so `applySearchPatch` clears the currency in play and the server answers the
unit from the listings in the area the patch is about. The unit the screen is
using travels in the context, so the model can SAY "under 1,200 zł" — a read,
never a write.

## A place that does not resolve is said out loud

`resolvePlace` answers `ambiguous` (several real places carry the name) or
`not_found`, and **refuses to choose**: taking the first candidate is the
homonym bug (ADR 0002 §12.2). `domain/places.ts#resolveCity` discounts a
candidate holding no listings before judging — a row holding nothing cannot
answer "what is in it" — so the three Spanish `cities` rows named Barcelona
(two of them empty, under three duplicate REGIONS; `docs/postgres.md` carries the
census) resolve, while two Barcelonas that both hold listings are still refused.

Refusing silently was the defect ("muéstrame pisos en Hamburg", twice, and the
app did not move). So Homiio's renderer for `homiio:resolvePlace`
(`components/sindi/sindiToolRenderers.tsx`) draws the sentence in the
conversation from the tool's own answer — `sindi.place.ambiguous` asks which
one, `sindi.place.notFound` says Homiio has no such place — whatever the model
writes. It is a renderer and not a host tool because a host tool moves the app
and draws nothing in the thread. No candidate list rides along: a picker of the
two Barcelonas is ADR 0002 §7's `disambiguating` state, not a chat card.

## Tool renderers

Keyed `homiio:<tool>`, which the SDK parses only from the canonical
`oxy_homiio__<tool>` name, never from free text. The same renderers draw a
consulted agent's results.

| Key | Draws |
|---|---|
| `homiio:searchListings`, `homiio:findNearbyListings` | up to four `PropertyCard`s and "and N more" |
| `homiio:getListing` | one `PropertyCard` |
| `homiio:listSavedHomes` | `SindiSavedHomes`, from the person's own session (loading, failure and an empty list each say their own sentence) |
| `homiio:resolvePlace` | the clarification above, or nothing when the place resolved |

## What travels with a turn

`SindiAppContext` (`hooks/useSindiAppContext.ts`), serialised as the lines of
Alia's `clientContext` after Homiio's introduction (`alia.clientContext`). The
interface **is** the policy, because there is nowhere in it to put anything
else:

```ts
{ revision, presentation, destination, listingId?, offering?, locationToken?, scopeLabel?, priceMin?, priceMax?, priceCurrency? }
```

`locationToken` is the `loc` token, which by ADR 0002 §8.2 carries no coordinate
at any precision. `scopeLabel` is the area's name, already on screen.
`listingId` is the listing open on screen. The revision is never sent — it
exists for the stale check. Never sent: a pathname, a DOM snapshot, the store,
an IP, a GPS fix, a token, a document, a contact, or the contents of somebody's
saved list.

`presentation` is `side_by_side` for the docked panel alone, because it answers
"is there a main pane beside the chat?" — what the model needs to write "I've
opened it beside you". `Platform.OS` decides nothing: a narrow web tab, a wide
native tablet and the full-screen chat on a big monitor are each answered by
their host and their tier (`components/sindi/sindiHost.ts`).

## Files, voice, sharing

- **Documents and images** go to Alia as `file` / `image_url` parts (documents
  are uploaded to the person's Oxy Files). Sindi's `attachments.documents` gate
  maps to the catalogue's `sindi.files` feature: Alia checks and consumes it on
  the server before any credit is reserved, and a refusal calls
  `onFeatureLocked`, which opens `FilePremiumInfoSheet` (`hooks/useSindiUpsell.ts`).
- **Voice** — dictation and calls — is the SDK's.
- **Sharing**: the conversation header mints Alia's link
  (`POST /v1/conversations/:id/share`, 24 hours by default) and Homiio shares
  `https://homiio.com/sindi/shared/<token>`. The shared page never carries a
  tool's output, which can hold the person's own data.
- **Conversations and titles** are Alia's (`/v1/conversations?agentId=`), and
  an empty chat offers the agent's own starters. Homiio's conversation tables
  were dropped (migration 0036, `post`), not migrated.

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
`createReservation` or `requestExchange`. Sindi's conversations are Alia's.

**Rent through Peable** is not connected ([`peable-rent-payments.md`](./peable-rent-payments.md)):
there is no processor and no route, so the payment tools record the ledger and
"set up payments" does not exist yet.

`capabilities/routeCoverage/*` maps every authenticated route to its tool or a
written exclusion, and `routeParity.test.ts` walks the real router and fails on
a route with neither. The exclusions are the scraper, Telegram operator tooling, Stripe webhook/debug/manual routes, the
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

## Where each capability went

The cut (Alia ADR 0020 §8; owner's clean cut, no compatibility window: old
native binaries get 404 from the removed `/api/ai` until they update).

| Before | Now |
|---|---|
| `/api/ai/stream` relay, Vercel data stream | `AliaChatContent agent={sindi}` / `AliaAskProvider` → Alia `/v1/chat/completions` |
| `extractFiltersWithAI` + internal HTTP to `/api/properties/*` | the model calls `resolvePlace` → `searchListings` / `findNearbyListings` / `getListing` |
| `<PROPERTIES_HINTS>` / `<PROPERTIES_CONTEXT>` system text | structured tool output |
| `<PROPERTIES_JSON>` + `PropertiesFromIds` | renderers `homiio:searchListings`, `homiio:findNearbyListings`, `homiio:getListing` → `PropertyCard` |
| server-derived `SindiActionEnvelope` | host tools `host_homiio__*` from the same `SindiAction` union and executor |
| `clarify_location` | `resolvePlace` answers `ambiguous` / `not_found` → the `homiio:resolvePlace` renderer, the same sentence |
| `wantsListings` (asking ≠ navigating) | the host tool's description (`apply_search` vs `searchListings`) plus Sindi's prompt |
| `appContext` revision, stale turns | `clientContext` per turn; the revision taken at turn start; the SDK's once-per-call and abort |
| host act modes (`sindiHost.ts`) | unchanged |
| "show me my saved homes" inline | renderer `homiio:listSavedHomes` → `SindiSavedHomes` |
| PDF contract review, housing image analysis | Alia `file` / `image_url` parts plus Sindi's prompt |
| Homiio+ file gate (client-only; credits never spent) | feature gate `sindi.files`, enforced and consumed on the server; locked → `FilePremiumInfoSheet` |
| Homiio conversation tables, titles, 24 h share links | Alia conversations (`useConversations({ agentId })`), titles and share links; Homiio's tables dropped |
| `/api/ai/suggestions` | Sindi's starters (Alia) on an empty chat; fixed i18n prompts on a listing |
| docked/overlay panel, `/sindi` screens | the SDK's conversation on the same surfaces |
| in-property bottom sheet | `useAskAgent().ask('sindi', turn)`: one sheet for Alia and Sindi |
| sidebar "Ask Alia", bottom-bar Alia button | `ask('alia')` |
| voice dictation (`expo-speech-recognition`) | the SDK's dictation and calls |
| tips toggle (never persisted, read by nothing) | persisted; hides Sindi's starters |

New with the cut: every action a person can take in Homiio through the
catalogue, fully autonomous within Sindi's configuration and with no approval
cards; Alia consulting Sindi from any app; Homiio's public MCP.

## Tests

| File | What it pins |
|---|---|
| `frontend __tests__/sindi/actionContract.test.ts` | the declaration (names, schema from the parser's fields, no write), every refusal, patch semantics, outcome lines |
| `frontend __tests__/sindi/actionExecution.test.ts` | WHEN each half of an action runs, per host, against the SDK's real stream store; stale and failed; every destination is a real route |
| `frontend __tests__/sindi/controlCapability.test.ts` | the capability for every host at every breakpoint |
| `frontend __tests__/sindi/clarifyLocation.test.tsx` | the clarification sentence from the shipped strings; no host tool for it |
| `frontend __tests__/sindi/toolRenderers.test.tsx` | which tools are drawn and what each draws |
| `backend __tests__/capabilities/*` | the catalogue, `resolvePlace`'s refusals, route parity |
| `backend __tests__/unit/directProviderInferenceUnreachable.test.ts` | no backend source imports `@alia.onl/*` or `@oxy.so/core/inference`, or names Alia's API |

## Still open

- **Currency** in a price patch (above): by design, not a gap.
- **Undo.** #519 §8.7 permits an undo control and does not require one; there
  is none.
- **The region-level duplicate data** behind the Barcelona trio
  (`docs/postgres.md`).
- **Tips in the sheet.** The SDK's sheet always offers an agent's starters, so
  the tips switch applies to the panel and the full-screen chat.
