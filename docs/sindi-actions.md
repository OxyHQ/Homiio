---
title: Sindi acting on the app
---

# Sindi actions

How the assistant changes what the main pane is showing — and every rule that
stops it from doing anything else.

Delivered for #519 §8, and revised once after somebody used it. The product ask
was one sentence: *"Sindi debe actuar sobre la app cuando permanece al lado de
ella."* Asking for flats under €1,200 with the panel docked opens Explore with
those filters, in the main pane, without closing the chat.

The revision is the other half of that sentence. Read literally, "al lado de
ella" left the full-screen chat and the overlay panel doing nothing at all: a
person typed *"muéstrame pisos en hamburg"*, twice, and the app did not move.
Their instruction was *"debería interactuar como hablamos"*. So **every host
acts now**, in the way that host can make visible — see
[Which host, and what acting means there](#which-host-and-what-acting-means-there).

## The two channels

A turn produces **text** and, sometimes, **one action**. They travel separately
and neither is derived from the other.

```
POST /api/ai/stream   { messages, conversationId, turnId, appContext }
   │
   ├─ extractFiltersWithAI(user's message)  →  { filters, wantsListings }
   │        │
   │        └─ services/sindiActions.ts  →  SindiActionEnvelope | null
   │                                          (city resolved, never guessed)
   │
   └─ aliaChat.streamText(...)  →  text deltas
                                          │
 data frame (2:)  ─────── action ─────────┤
 text frames (0:) ─────── prose ──────────┘
                                          │
                              useChat → { messages, data }
                                          │
                  hooks/useSindiActions.ts → applied | inline | rejected | stale | failed
```

**The action never comes from the assistant's prose.** #519 §8.5 forbids two
things by name — inferring executable actions with a regex over the reply, and
turning `<PROPERTIES_JSON>` into a command language — and the shape above is
what makes both unreachable: the emitter runs before the model answers and never
sees what it said.

## Why the server derives it, and what would change if Alia gained tools

The textbook design gives the model a tool. Homiio cannot today: Alia owns
Sindi's tools and memory, and while `@alia.onl/server@1.0.1` carries an
`alia.tool_result` event, **there is no evidence that Sindi's Alia agent has
Homiio tools provisioned** — #519 §8.5 is explicit that a prompt mentioning a
capability is not evidence of one, and this change did not assume otherwise.

What Homiio does already own is the intent extraction: `/ai/stream` has run
`extractFiltersWithAI` over the user's own message, and performed the search
itself, since long before this. So the action is derived from a structured
extraction of what the **person** asked.

If the upstream grant lands, `services/sindiActions.ts` is the only file that
changes: the intent stops coming from Homiio's extraction and starts coming from
an `alia.tool_result` frame. The contract, the validation, the executor, the
capability rule and every test below are unaffected.

## What Sindi may do

Five intents, in `shared-types/sindiAction.ts`. The union is **closed**, and
adding to it is a reviewed edit to that file.

| Intent | Payload | Executed as |
|---|---|---|
| `apply_search` | a **patch** over the live query | the canonical pipeline → `/explore` |
| `show_saved` | an optional folder id | `/saved`, or `/saved/[folderId]`, under the reader's own session |
| `open_listing` | one validated property id | the listing route |
| `set_results_view` | `list` \| `map` | `store/exploreViewStore.ts`; filters untouched |
| `navigate` | one **enumerated** destination | the router's own path table |

**Nothing here writes.** Paying, signing, applying, messaging a third party,
publishing and deleting are not in the union and may not be added to it: each
needs its own explicit action and its own domain controls. Controlling the app
is not a session with unlimited permissions.

There is no `eval`, no generated JavaScript, no DOM click, no arbitrary URL, no
API method chosen by a model and no SQL. `navigate` takes a destination from a
five-member enum rather than a path, because a path is a string and a string is
an open door.

## `apply_search` is a patch, not a query

Absent keys leave the live query alone. That is what makes *"ahora con dos
habitaciones y que admitan mascotas"* keep the area and the budget the previous
turn established; a full query would silently reset every field the model did
not restate.

`location` is the one field that **replaces** rather than merges, because a
geographic selection is atomic (ADR 0002 §3) — "the old city with the new
bounds" is unrepresentable by construction.

The offering is applied **first**, because switching it clears the price range
on purpose (a monthly rent is not a nightly rate), so a patch carrying both must
set the offering before the price or the price is dropped.

### Ambiguity is refused — but duplication is not ambiguity

A city name that resolves to several REAL places produces **no area at all**.
Taking the first candidate is the homonym bug (ADR 0002 §12.2) arriving through
a new door. The rest of the turn still applies — "under 900" against whatever
area is in force.

**This refusal was firing on "Barcelona", and it made the most ordinary request
Sindi can receive do nothing at all.** Production carries three `cities` rows
named Barcelona in Spain, all with the slug `barcelona`, and two of them hold
zero listings. The unique index was `cities_region_name_key`, on
`(region_id, name)`, and raw text compares case-SENSITIVELY — so a lower-cased
name slipped past it, and a second region inside the same country took the rest.
With no location and no other constraint in the sentence, `searchPatchForTurn`
returned `null` and no action was emitted: the person saw nothing happen and
nothing said.

Migration 0029 is the other half: it folds the duplicate rows together and makes
the index `(region_id, slug)`, so a region holds one `barcelona` and that
particular trio cannot re-form. The rule below is still load-bearing without
them, because **cross-region** homonyms are legal by design (ADR 0002 §12.2) and
an empty one is exactly as unhelpful as an empty duplicate was.

`resolveCity` now discounts a candidate holding **no listings** before judging.
That is not a popularity tiebreak — `placeLookup`'s header forbids
`properties_count` deciding between candidates and this does not ask it to. It
is narrower and true: a row holding nothing cannot answer "what is in it", so it
is not a candidate to be ambiguous with. Two genuine Barcelonas that both hold
listings are still refused, which is the case the rule exists to protect.

The rule lives in `sindiActions.ts` rather than in `lookupCityPlaces`, because it
is a property of the QUESTION: a place picker offering somewhere to browse
should still show an empty city.

**Two corrections to what this page used to say.** It claimed "Sindi's prose
asks which Barcelona was meant" — nothing tells the model the name was
ambiguous, so it does not. And the prose and the action resolve the city through
DIFFERENT code: the prose path calls `/api/properties/search?city=…`, whose
`resolveCityId` picks a row, while the action path calls `lookupCityPlaces`,
which refuses. One turn, two resolvers, and until now two different answers.
Narrowing that is what the rule above does; collapsing them into one resolver is
still open.

**The root cause is the data**, and it is not fixed here: three rows for one
city, and a case-sensitive uniqueness constraint that permits a fourth. Merging
them means repointing every address that references the duplicates, which is a
migration with a real blast radius and its own audit.

### Why a price patch still carries no currency

`SindiSearchPatch` has **no currency field**. The reason has changed rather than
gone away: the price filter now takes one (ADR 0002 §14.2), so this is no longer
a field the server would ignore — it is a field nothing can honestly fill.

Somebody who says *"under 1,200"* has named an amount and not a unit. Filling it
from the conversation's last scope would apply their number in a currency they
never mentioned, which is how *"under 1,200"* said after a Kraków search becomes
1,200 złoty.

So a price patch carries the bound alone and `applySearchPatch` **clears the
currency in play** when it lands — as it does when the patch moves the scope.
The unit then goes back to the server, which answers it from the listings in the
area the patch is about and reports which one it used. The live query's unit
does travel in the app CONTEXT (`SindiAppContext.priceCurrency`), so the model
can say "under 1,200 zł" instead of guessing euros; that is a read, never a
write.

## Which host, and what acting means there

`canControlApp` used to be `panelVisible && panelDocked` — both facts about the
**panel**, used to answer for three different surfaces. Three render
`ChatContent`, and only one of them is the panel:

| Host | Where it is mounted | Mode | What acting means |
|---|---|---|---|
| `panel`, docked (≥ 1024) | `AppShell`'s `aside`, beside `<Slot/>` | `beside` | navigate the page column; the chat stays put |
| `panel`, overlay (500–1023) | `AppShell`'s `overlay`, beside `<Slot/>` | `reveal` | navigate, then close the panel once the answer is written |
| `screen` (`/sindi/:id`) | inside `<Slot/>` — it IS the route | `leave` | go to the destination, once the answer is written |
| `sheet` (in-property) | a sheet over the listing being read | `offer` | nothing: it sends no app context, so no action arrives |

The measured failure behind the revision: `uiStore.sindiPanelOpen` is
**persisted**, so somebody who once opened the side panel on a wide window got
`docked: true` inside the full-screen chat for ever after — the same chat acted
or refused depending on an unrelated surface's flag. `components/sindi/sindiHost.ts`
takes the host as an input for exactly that reason, and the `screen` host's
answer does not read the layout at all.

**An overlay is still not side-by-side.** #519 §8.2's argument holds — while it
covers the page, announcing a change nobody can see is worse than not changing
anything — but the conclusion moved: the panel gets out of the way instead of
the action being refused. `presentation` stays `side_by_side` for the docked
panel alone, because that field answers "is there a main pane beside the chat?"
and the model would write "I've opened it beside you" from it.

`Platform.OS` still appears nowhere. A narrow web tab, a wide native tablet and
the Sindi route on a large monitor are each answered by their host and their
tier, never by their platform. The capability is **re-read at execution time**,
not at stream start, because a window can be resized mid-answer.

### Why two of the three modes wait for the turn to end

The action frame is written to the data channel **before the first text delta**
(`pipeStreamingTextDataStream`, on purpose: apply the action while the sentence
describing it arrives). So at execution time Sindi has said nothing yet.

`reveal` and `leave` both end with the chat's own surface gone — closing the
overlay panel unmounts `SindiPanel`; navigating off `/sindi/:id` unmounts the
routed screen. Run on that first frame, either one replaces a streaming answer
with an empty screen. So the executor applies the STATE half immediately (the
search query, the results view) and hands the half that removes the chat to
`useSindiActions.settleTurn`, which `useSindiConversation` calls when the stream
stops. `beside` defers nothing: the panel is mounted beside `<Slot/>` and
survives any navigation.

Settling also runs after **Stop**. Stop cancels the answer, and the only reason
the navigation was waiting was so as not to cut that answer off; what arrives
*after* a stop still names a turn that is no longer active and is refused.

## When an action may still be applied

Four refusals, in `hooks/sindiActionRules.ts#envelopeRefusal`:

| Check | Refusal | Closes |
|---|---|---|
| `actionId` already run | `rejected` | a replayed or duplicated frame navigating twice |
| `turnId` is not the active turn | `stale` | a cancelled turn's late action — this is what makes **Stop** stop |
| `contextRevision` ≠ the current one | `stale` | the user changed a filter by hand; **their change wins** |
| the host cannot show a result (`sheet`) | `inline` | moving the page under a sheet somebody is reading |

**History executes nothing, structurally.** Actions arrive on the AI SDK's data
channel, which belongs to a live stream. A conversation restored from the store,
a shared transcript opened by link and a Markdown re-render all carry text and
nothing else — there is no code path from a stored message to the executor.

**A search is one navigation.** The executor builds the whole next query and
navigates to its `exploreHref` in a single operation; #519 §8.6 forbids a bare
`router.push('/explore')` followed by a patch, because `/explore` hydrates from
the URL and the patch would race it.

## The offer is the fallback now, not the common case

With no surface that could show a result the outcome is `inline`, and
`SindiActionCard` renders the action as a button. This used to be the answer for
two hosts out of three; it is now reserved for the in-property sheet, which
sends no context and therefore receives no action — so in practice the card
renders outcomes rather than offers.

It is kept rather than deleted because `inline` remains the honest outcome for a
host that cannot present a result, and because pressing it is the intervention
#519 §8.1 asks for — *"una representación/acción explícita dentro del chat; no
sustituir la pantalla sin intervención"* — the one legitimate route past the
capability check. Nothing is deferred for a press: the person read first, so
there is no answer left to interrupt.

The homes themselves already appear as cards in the conversation (the existing
`<PROPERTIES_JSON>` rendering), so the offer adds the navigation, not the
results.

The card also reports what actually happened. `applied` names the change;
`stale` says the user's own later change won, and is deliberately not styled as
an error; `failed` says so plainly. Sindi never claims to have changed filters
the executor left alone.

## What travels with a turn

`SindiAppContext` — and the interface **is** the policy, because there is
nowhere in it to put anything else:

```ts
{ revision, presentation, destination, offering?, locationToken?, scopeLabel?, priceMin?, priceMax? }
```

`locationToken` is the `loc` token, which by ADR 0002 §8.2 carries no coordinate
at any precision (the device case serialises to `here.<radiusMeters>`).
`scopeLabel` is the area's display name, already on screen. Never sent: a DOM
snapshot, the store, an IP, a GPS fix, a token, a document, a contact, or the
contents of somebody's saved list.

The **revision** is a hash of the live query. It rides with the turn and comes
back in the envelope, which is how a manual filter change mid-turn is detected.

The in-property bottom sheet sends **no context at all**: it declares
`host="sheet"`, a host that cannot act, and whether a context is sent follows
from the capability rather than from a second switch somebody could set the
other way.

## The conversation-id fix

`useSindiConversation` used to promote a new conversation's id with an
unconditional `router.replace('/sindi/:id')`. Correct for the full-screen route,
which owns that address; a disaster from the docked panel, which would replace
whatever the user was reading with the full-screen chat.

The hook now holds no router at all and calls `onConversationPersisted`. The
full-screen route replaces its own address; the panel updates its selected
conversation; the bottom sheet does neither.
`__tests__/sindi/conversationHostPromotion.test.ts` is the gate.

## Tests

| File | What it pins |
|---|---|
| `frontend __tests__/sindi/actionContract.test.ts` | the closed union, every refusal, patch semantics |
| `frontend __tests__/sindi/controlCapability.test.ts` | the capability for every host at every breakpoint |
| `frontend __tests__/sindi/actionExecution.test.ts` | WHEN each half of an action runs, per host |
| `frontend __tests__/sindi/conversationHostPromotion.test.ts` | the panel navigates nothing; every destination is a real route |
| `backend __tests__/integration/sindiActions.test.ts` | derivation, homonyms, context validation (real Postgres) |

## Still open in #519 §8

Named here so the gap is visible rather than implied:

- **Alia tool results.** The bridge consumes Homiio's own extraction; an
  `alia.tool_result` frame is not read yet, and the upstream grant is unverified.
- **`show_saved` inline results.** Chat-only offers the navigation; it does not
  yet render the person's saved homes as cards inside the conversation.
- **Currency.** See above — §6.1's row, untouched.
- **Undo.** #519 §8.7 permits an undo control and does not require one; there
  is none.
