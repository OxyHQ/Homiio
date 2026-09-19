# Tenant–landlord messaging: the ecosystem audit

#518 §7.3 asks for a real conversation tied to a lease, an application, a
booking or an exchange — and asks for something *before* any code:

> *Reutilizar la plataforma de mensajería del ecosistema si existe una
> capacidad estable aplicable, con un adaptador claro; no asumir que la bandeja
> de notificaciones o el chat con Sindi ya son mensajes entre particulares.*

This page is that audit. Everything in it was read out of the repositories on
2026-09-19 and each claim names the file it came from, because the whole point
of the exercise is to stop "there is no messaging platform" and "just use the
messaging platform" from both being assertions nobody checked.

**The short answer: the capability exists, it is good, and it is not consumable
from this repository today.** Three specific things have to be decided by a
person before Homiio writes a line of messaging code. They are in §5.

---

## 1. What Homiio has today, and what it is not

- **The Inbox tab is a notification list.** `services/notificationDispatchService.ts`
  is a one-way dispatcher: a domain action writes a row into somebody's mailbox.
  There is no reply, no thread and no second participant. Wiring "Message
  landlord" to it would produce a button that sends nothing, which is what §7.3
  names in its own sentence.
- **Sindi is not person-to-person.** It is an Alia agent. The bearer on that path
  authenticates a human to Homiio and a requester assertion to Alia; no other
  Homiio user is ever on the other end.
- **There is no realtime socket client** (`AGENTS.md`), so any "typing…" or live
  delivery would need a transport this app does not have.

So nothing here can be extended into messaging. The question is entirely what to
adopt.

## 2. What the ecosystem has

| Repo | Messaging? | Evidence |
|---|---|---|
| **Allo** | **Yes — this is the platform** | `packages/core` "headless client (client instances, MLS end-to-end encryption, sync, outbox, conversations, messages, media)" |
| oxy-api (OxyHQServices) | No | `packages/api/src/routes/` has `notifications.routes.ts` and `contacts.ts`; there is no conversation or message route |
| Mention | No | `packages/backend/src/routes/` has no DM route; every "conversation" hit is a post thread |
| Inbox | No (different thing) | Email client; `~/Oxy/docs/project-map.md` — its backend is oxy-api |

**Allo is the answer to "does a capability exist".** It is not a chat screen
bolted onto a social app: it is a documented platform with its own ADR
(`Allo/docs/adr/0001-clean-break-platform.md`), MLS end-to-end encryption, a
device-enrollment model, history transfer, encrypted backups, an outbox, blobs,
and a message-kind system (polls, places, contacts, pins) that needed no server
change because the server only ever carries ciphertext.

**It is also explicitly multi-product.** `APP_ID_PATTERN` in
`Allo/packages/shared-types/src/common.ts` is documented as *"The product an
instance belongs to: `allo`, `mention`, …"*, and a DM is keyed
`${appId}:${accountA}:${accountB}` (`dmKeyFor`), so a Homiio enquiry would be a
different conversation from the same two people's personal Allo thread. The
design anticipated exactly this.

## 3. Why it cannot be adopted this week

### 3.1 The SDK is not published

`@allo/core`, `@allo/react` and `@allo/shared-types` are each
`"private": true`, and all three answer **404** on the public registry. Homiio
has no private registry configured (`bunfig.toml`, `.npmrc`), and `@oxy.so/*`
comes from public npm.

There is no import path from this repository to that SDK. Publishing it — or
extracting a client — is work in the Allo repo, and it is not a formality: the
Metro configuration alone needs the `@hpke/*` ESM mapping and the `ts-mls`
optional-peer aliases Allo's `metro.config.js` documents, or the static-render
bundle dies with *"Requiring unknown module @hpke/common"*.

### 3.2 A server cannot open a conversation

`POST /v1/conversations` takes an `mlsGroupId` and an `initialCommit` at epoch 0
carrying the welcome (`createConversationRequestSchema`). Those are produced by
a client holding MLS key material. **Homiio's backend cannot create a
landlord↔tenant thread**, and neither can a job, a webhook or an admin.

This rules out the shape a housing app reaches for first — "when an application
is approved, open a conversation between the two parties" — unless one of them
is on a device at the time.

### 3.3 Undelivered is the normal case, not the edge

Allo's own design handles a member with no device: the message is held
`pending` with `holdReason: 'no_reachable_member'`
(`packages/core/src/messages/service.ts`), and the UI says *"<Name> hasn't set
up Allo yet. Your messages will be delivered when they join."*

That is the right behaviour for a messenger, where both people chose to install
it. For Homiio it is the **primary** path: a tenant enquiring about a flat is
messaging a landlord who may never enrol. "Your message will be delivered when
they join" is honest and is also, for an enquiry about a flat available this
week, a failure. Any adoption has to answer what Homiio does instead — an email
fallback, an enquiry record the landlord sees on their own listing, or a refusal
to offer the button until the other side is reachable.

### 3.4 Enrolling Homiio enrols a device on the person's whole account

This is the finding that most needs a human decision.

`registerInstance` (`Allo/packages/backend/src/services/platform/instanceService.ts`)
bootstraps on `countActiveInstances(accountId)` — **not scoped by `appId`**:

```
/** Bootstrap rule: zero active instances ⇒ active at once; otherwise pending with a challenge. */
```

And the trust path does not filter by app either: `trustedOwnInstances()`
(`packages/core/src/instance/manager.ts`) returns every active instance on the
account that passes the chain check, and `listConversationIdsForAccount`
(`db/platform/conversationRepository.ts`) selects a member's conversations by
`account_id` alone.

Two consequences, both real:

1. **A person who already uses Allo would get a *pending* Homiio instance.**
   Their Homiio "message landlord" button would sit behind an *approve this
   device* screen in a different app. A housing enquiry would begin with a
   cross-product device-approval flow.
2. **Once approved, the Homiio instance is a device on their personal
   messaging account.** The elector adds a newly active instance to the
   account's groups and a donor device offers it history — the mechanism Allo
   documents for "a second phone" — so the Homiio client would hold keys to the
   person's private Allo conversations.

That may be entirely intended: a device is a device, and the account holder
approves it. But it is a product and privacy decision about what Homiio becomes,
not a detail of an adapter, and it is not ours to make quietly.

### 3.5 What Homiio would still own

Nothing in the platform links a conversation to a domain object.
`conversationSummarySchema` carries `kind`, `appId`, `mlsGroupId`, `epoch`,
`members`, `leaves` and timestamps — there is no `subject`, no metadata bag.

So the "adaptador claro" §7.3 asks for is a Homiio-side table mapping a lease,
an application, a reservation or an exchange to a conversation id, with the
authorization enforced in the repository query like every other Homiio
ownership check — which is also how §7.3's *"separar permisos de contacto
inicial y de acceso a documentos/contratos"* gets enforced, since the platform
knows nothing about either.

And unread, deep links and retention stay Homiio's: unread is a client fact
(read receipts are encrypted messages), and **content retention is not something
Homiio can implement at all** against an E2EE store — "conservación de
conversaciones" can only mean membership and metadata.

## 4. The alternative, stated fairly

Homiio could build a first-party `conversations` domain in its own Postgres:
two participants resolved server-side from a lease or application, paginated
history, an idempotency key per send, unread per participant, attachments
through the private object store that repair photos and receipts also need.

It is a week or two of ordinary work in a codebase that already has every
pattern it needs, and it would ship without a cross-product dependency.

What it costs is the thing the epic asked about: the messages are readable by
the server, it is a second messaging system in the ecosystem, and it will
diverge from Allo the day either changes. That is a trade, and the trade is the
decision.

## 5. What is blocked, and on whom

Three questions, none of which an implementer should answer alone:

1. **Is a Homiio session allowed to become a device on the person's Allo
   account?** (§3.4.) If no, Allo cannot be adopted as it stands and the
   platform would need per-app instance scoping — a change in the Allo repo.
2. **Will `@allo/core` / `@allo/react` be published, and supported as a
   dependency of another product?** (§3.1.) Without that there is nothing to
   import.
3. **What does Homiio do when the other party has no device?** (§3.3.) Held
   messages are the platform's answer; a housing enquiry needs a product answer.

Until those are answered, `docs/housing-parity.md` keeps the row **blocked**
with this page named, and **no "Message landlord" button is drawn**. A button
that opens a screen which cannot send is the simulated success both epics
forbid — and the Inbox tab is not to be wired to it.
