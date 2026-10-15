# Case team chat

The creator opens **Team chat** from the authenticated case team panel. The Allo page uses the current account's Oxy linked client to read and finalize Homiio operations, and `@allo/core` to create and change the encrypted group. A collaborator opens the existing Allo conversation. The group uses a generic name; no title, address, case description or messages move into the other product's database.

Homiio keeps one encrypted opaque Allo read reference, separate from public case projections. It contains no conversation snapshot. The read grant reveals only the group's owner, account membership, epoch and operation status, through `@allo/sdk`; it does not authorize writes or decrypt messages. Allo hashes this reference. Operation-specific Homiio read capabilities are HMAC-derived, sent in headers only, and never returned in case or team DTOs. All remote origins are fixed by their owning SDK. Human bearers go directly from the frontend to the receiving product's Oxy verifier.

## Interrupted changes

1. Homiio takes the case lock and writes one durable intent for creation or a collaborator change. Its target accounts are Homiio's own membership facts. Direct collaborator writes refuse to proceed once a chat reference exists.
2. Allo's creator-signed operation freezes application events before changing the group's membership. Account removal includes all current devices, retries after an epoch conflict re-evaluate those devices, and even an account with no installed device is removed through an MLS epoch change.
3. Homiio reads a coherent Allo snapshot through the SDK and commits its local change only when the operation is frozen, belongs to this case and creator, and has exactly the intended membership. The existing collaborator mutation boundary also revokes older exact-location grants and records the actor.
4. Allo reads Homiio's immutable finalized operation before releasing the freeze. A lost response retries the same operation. An unavailable dependency leaves the change pending and messages paused; it never treats a queued MLS request as successful revocation.

Finalized operations remain as durable idempotency records. They do not expire: expiring a pending intent would strand a frozen group or permit unsafe recovery. Case deletion cascades the local records; an unfinished Allo operation then remains frozen. Existing downloaded history remains on recipients' devices. There is no background content synchronization.

## Rollout

Apply Homiio migration `0032_team_chat` and Allo migration `0011_managed_teams`, then deploy their corresponding APIs and SDK consumers. Provision `/oxy/homiio/HOMIIO_TEAM_CHAT_KEY` as a SecureString containing 32 random bytes encoded as 64 hex characters **before** the API task references it. The deploy binds its ARN without copying secret values through GitHub. Keep this key stable across API replicas and restarts; rotation requires re-encrypting the stored references. Without it the workflow refuses to begin. No secret was provisioned and no deployment was performed during implementation.

Automated checks use real Postgres on both sides, real SDK response parsing, and real Allo instance signatures and MLS. They cover retries after lost create/add/remove replies, freeze/release interruption, unauthorized actors, stale and mismatched proofs, concurrent creation, no-device accounts and retained historical messages after removal. Native app-link/account switching on physical devices remains a rollout check.
