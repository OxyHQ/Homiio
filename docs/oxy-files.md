# Photos and documents: Oxy Files

> The platform model is Oxy's ADR 0043 ("Who owns a file, who uses it, and
> when it goes away"). This page says how Homiio applies it, how the move off
> Homiio's own bucket runs, and what has to be true before the bucket goes.

Homiio stores no public photo bytes of its own any more. Every photo it shows
is a file in **Oxy Files**, and Homiio keeps only its record of showing it (an
`images` row naming `oxy_file_id`) and the four rendition URLs Oxy serves.
Private tenancy documents are PRIVATE files in their uploader's own Oxy
account, read back through the consent Oxy records when Homiio stores them (see
[Private documents](#private-documents)).

## Who owns what

| What | Owner (ADR 0043 D1) | Enters through | Used by (reference `entityType` / `entityId`) |
|---|---|---|---|
| A host's listing photo | the **host's account** | `POST /api/images/upload` → `uploadUserMedia` (EXIF stripped first); minted into `images` at publish after Oxy confirms the file is the publisher's own | `property` / listing id |
| A scraped listing photo | the **Homiio application** | `ExternalMediaIngest` → `importAppFiles` (Oxy fetches it; the same URL is never downloaded twice) | `property` / listing id |
| A Wikimedia city cover | the **Homiio application** | `cityCoverSyncService` → `importAppFile`, credit from Commons `extmetadata` stored on the row (`attribution_*`) and served with the cover | `city` / city id |
| An eviction case cover | the **organiser's account** | `POST /api/images/upload`, resolved by `controllers/eviction/coverImage.ts` | `eviction_case` / case id |
| A region cover | the **Homiio application** | (nothing writes one today) | `region` / region id |
| Lease, application and maintenance documents | the **uploader's account** (the applicant's, for an application), PRIVATE | `services/files/privateDocuments.ts` → `uploadUserMediaLarge(…, { visibility: 'private' })`; `oxy:<fileId>` on the row | `lease` / lease id, `tenant_application` / application id, `maintenance_request` / request id |

A person's file is theirs: when Homiio stops using it, Oxy shows it to them as
"not in use" and never deletes it. A Homiio-owned file nobody uses is trashed by
Oxy after 24 hours and deleted 30 days later (ADR 0043 D5).

Every URL Homiio hands out is a rendition, never the bare file
(`services/files/imageUrls.ts`): `small` → `w320`, `medium` → `w640`, `large` →
`w1280`, `original` → `w2048`. Oxy serves a file's own bytes unmodified, and an
imported portal photo keeps whatever EXIF it came with; the renditions are
re-encoded, so ADR 0003's "privacy by precision" holds for imports too.

## "In use", precisely

A (file, entity) pair is in use while the entity shows a photo whose `images`
row names the file: a `property_images` row of the listing, or the city's,
region's or case's `cover_image_id`. It stops being in use the moment that row
goes — a photo removed from a listing, a listing deleted (by its host or by the
expiry sweep, through the CASCADE), a cover replaced or cleared.
`services/files/referenceUsage.ts` holds that definition and nothing else does.

- **Triggers mark, the drain decides.** Migration `0037_oxy_files` installs
  triggers on `property_images`, `cities`, `regions`, `eviction_cases` and
  `images` that mark every pair a write could have moved, in the transaction of
  the write (`file_reference_changes`; cascades included). The drain
  (`services/files/referenceSync.ts`, every API task, every 10 s) reads the
  PRESENT answer and adds or removes the reference, so the order of changes
  cannot leave a wrong state. A failed call backs off to six hours and stays
  visible (`attempts`, `last_error`).
- **Nightly reconciliation** (`referenceReconcile.ts`, 04:10 UTC, one task per
  type) sends Oxy the full inventory per entity type from one snapshot, then
  re-marks the pairs the drain settled during it. The inventory pages by ENTITY
  on the source table's own index (`referenceUsage.referenceInventory`), so a
  page reads only its own rows: paging the joined pairs re-joined every photo
  per page, and the first production dry run (2026-10-20) ran two hours as the
  shared database's heaviest statement without finishing `property`. It is
  handed to the SDK at most 200 pages of 1,000 a minute (Oxy allows 240 per
  application, and a 429 mid-upload ends the session): ~10 minutes for
  `property`.
  `scripts/reconcileFileReferences.ts` runs the same thing on demand — a dry
  run by default (Oxy answers what it would add, remove and refuse, and
  changes nothing), `--apply` to commit, `--type=` for one entity type.
- **Orphans end at the root.** An `images` row nothing shows is deleted 24 hours
  after it was written (`db/images/unusedImages.ts`, 03:40 UTC). Before this,
  expired listings left ~950 rows (and their objects) behind and nothing would
  ever have removed them.

## File events

`POST /webhooks/oxy/files` (`routes/oxyFilesWebhook.ts`) verifies Oxy's
signature (`OXY_FILES_WEBHOOK_SECRET`), echoes the endpoint challenge, applies
each event once (`oxy_file_events`) and only if it is newer than the last one
applied. A file `blocked` (rights claim), `trash`, `deleted` or made `private`
is hidden everywhere Homiio shows it — listing reads, `has_images`, city
covers, eviction-case covers — and `file.unblocked` / `file.restored` bring it
back where it was. Nothing is deleted by an event.

## Private documents

`services/files/privateDocuments.ts` is the ONE module that stores and reads a
lease document, an application document or a maintenance photo (ADR 0043
stage 4c, OxyHQ/oxy#1774).

- **Stored** as a PRIVATE file in the uploader's own Oxy account —
  `uploadUserMediaLarge(owner, bytes, { visibility: 'private', sha256 })`
  (`files:user-media:write`). A PDF goes verbatim, a photo re-encoded first
  (EXIF and GPS dropped). The row holds `oxy:<fileId>`
  (`lease_documents.url`, `tenant_application_documents.url`,
  `maintenance_request_attachments.storage_key`), and
  `lease_documents.content_sha256` is the digest Oxy verified. A private file
  never reaches `public/` or the CDN.
- **Read back** with `linkedDownloadUrls([fileId])` (`files:linked:read`) —
  allowed because Homiio stored the file FOR the person, which Oxy records as
  their consent. The short-lived URL is fetched on the server and never leaves
  it; the bytes must hash to what Oxy recorded. Who may read is still Homiio's
  party check in `domain/*` (lease parties, the application's applicant and
  landlord, the maintenance request's lease parties); Oxy's consent only says
  Homiio may read the file. When the person revokes Homiio's access in their
  file manager, or the file is trashed, deleted or taken down, Oxy leaves it
  out and the route answers 404. A re-upload of bytes whose access was revoked
  is stored in the bucket instead (the revocation survives the re-upload).
- **Referenced**: the document row is the use. Migration
  `0038_oxy_private_documents` marks the pair on every insert, update and
  delete (cascades included); the drain registers it and the nightly
  reconciliation covers the three types (`referenceUsage.ts`).
- **A client never names one.** A listed application document is a link the
  applicant supplies; one naming a stored document (`oxy:…` or a private
  bucket URL) is refused with 400 `INVALID_DOCUMENTS`, because the document
  route reads through Homiio's own access.

**Where a new one goes.** Every new document goes to Oxy. When Oxy refuses,
is down, answers a file that is not private, or answers a file Homiio may not
read, the document is stored in Homiio's bucket under `private/` instead, so an
upload never fails because of Oxy. Reading follows the row: an `oxy:` row reads
from Oxy, a bucket row from the bucket (counted in `legacy_media_reads`,
`private_document`).

**Moving the existing ones.** `scripts/migratePrivateDocumentsToOxy.ts`
(preview by default; `--apply`, `--limit`, `--concurrency`, `--report`). Each
object is read, hashed (a lease document must still match its
`content_sha256`), uploaded privately to its owner (the uploader; the
applicant for an application document), READ BACK through Homiio's consent
and hashed again, and only then is the row switched — compare-and-set, so a
row that changed meanwhile is left for the next run. The first
`read_back_refused` stops the run with exit 2: that is an Oxy without stage
4c (or without `files:linked:read`), and every row stays on the bucket, where
it still reads; at most `--concurrency` files were stored in owners' accounts,
which Oxy shows them as "not in use". A row naming nothing Homiio stores (an
applicant's own link) is `not_stored_here` and never moves. The bucket object
is kept until the bucket goes.

## Rollout

In this order. Nothing here runs against production from a developer machine;
the scripts run as one-off ECS tasks of the API image.

1. **Oxy:** the API deploy carrying ADR 0043 stages 1–4b, and `@oxy.so/contracts`
   4.24.0, `@oxy.so/core` 4.21.0 and `@oxy.so/services` 11.12.0 published.
   Stage 4c (OxyHQ/oxy#1774) is needed only for private documents, and only
   once the switch is on: deploying this before 4c is live changes nothing for
   them (switch off, every document in the bucket).
2. **The grant, once no Homiio mints a Sindi token.** Since #677 Sindi is an
   Alia agent and Homiio mints no Sindi service token, so nothing checks
   Homiio's token for an EXACT scope set any more: Oxy checks every Homiio call
   by inclusion. A Homiio from before #677 does — its Sindi canary refuses any
   token wider than `inference:invoke` + `acting-as:offline`, and Sindi and the
   backend attest as one workload. So once the running image is #677 or later
   (this deploy), Oxy staff grant the Homiio application and its workload
   binding `files:read`, `files:app:write`, `files:app:delete`,
   `files:references:write`, `files:user-media:write` and — for private
   documents — `files:linked:read`.
3. **The webhook secret.** Create `/oxy/homiio/OXY_FILES_WEBHOOK_SECRET`
   (SecureString, any placeholder) — the task definition names its ARN and a
   task does not start without it. Deploy. In the Oxy console (Homiio →
   Webhooks → File events) set `https://api.homiio.com/webhooks/oxy/files`; the
   challenge is answered without the secret. Put the `whsec_…` it shows into the
   parameter and force a new deployment of the API service.
4. **Migrations `0037_oxy_files` and `0038_oxy_private_documents`** (both
   `pre`) are applied by the deploy.
5. **Orphans:** `scripts/cleanOrphanImages.ts` (preview), then `--apply`.
6. **Copy:** `scripts/migrateImagesToOxy.ts` (preview), then `--apply
   --report=…` until the preview reports nothing left. A Homiio-owned photo
   is IMPORTED, 50 to a request: Oxy fetches it from the legacy door
   (`PUBLIC_API_URL` + `/api/images/file/<key>`), Homiio compares the SHA-256
   Oxy stored with the bucket object's, and the listing's use is registered in
   the same request. Oxy meters an application's uploads and imports together
   at 30 requests a minute — about two million photos is a day of batch
   imports, and would be seven weeks of uploads — and the live listing ingest
   spends from the same budget, so `--per-minute` (default 20) leaves it a
   third, and a 429 is waited out and the same request sent again
   (`services/files/oxyCallPacer.ts`); it is never a row's outcome. A run
   killed or redeployed under resumes where it stopped. Oxy's fetches are
   counted as legacy-door `served` reads, so the soak (step 7) starts when the
   copy ends. Read the
   `missing_object` lines (a shown photo whose object is gone — broken today)
   and re-run with `--detach-missing`. Legacy city covers are re-sourced with
   credit, or cleared if Commons answers with nothing creditable; one whose
   re-sourcing failed (Commons or Oxy did not answer) is `cover_failed` and
   kept for the next run. A region cover is cleared.
   The report carries row ids, outcomes and SHA-256s, never keys or URLs.
7. **Soak.** The legacy door keeps every old URL working: a migrated photo's
   old URL answers 301 to its Oxy rendition, an unmigrated one is still served
   from the bucket. `scripts/oxyFilesStatus.ts` prints the gate daily.
8. **Private documents** (needs Oxy stage 4c, OxyHQ/oxy#1774, and
   `files:linked:read`): run `scripts/migratePrivateDocumentsToOxy.ts --apply
   --limit=5` and read the report — `migrated` lines mean read-back works;
   exit 2 (`read_back_refused`) means it does not, and nothing moved. Then run
   it without `--limit` until the preview shows nothing `onBucket`. New
   documents already go to Oxy ([Where a new one goes](#private-documents)).
9. **References:** `scripts/reconcileFileReferences.ts` (dry run), read it,
   then `--apply`. Run it before Oxy's unused-file sweep is enforced for
   Homiio: an application file Homiio shows but never referenced reads as
   unused there.

## Retiring the bucket

`scripts/oxyFilesStatus.ts` exits 0 only when **the public half may go**: no
shown photo left in the bucket, zero `public_image`/`served` reads for 14 days,
and each of the 14 whole UTC days before today COUNTED — a row for every
(surface, outcome) pair (`daysCounted` = 14). Every API task writes those rows
every minute from boot, zeros included (`legacyReadCounter.ts`), so a day
without them is a day nothing was counting and never passes for a quiet one.
The counter wrote zeros from 2026-10-21; before that it wrote only on a read,
so no earlier day counts. Then, in one change:

- `legacyImages.resolveLegacyImage` answers redirects and 404s only (drop the
  bucket read), and `migrateImagesToOxy.ts` is deleted;
- a `post` migration drops `images.keys_*` except `keys_original` (the
  redirect's lookup key) and `images_storage_check` requires `oxy_file_id`.

The bucket itself — and `AWS_S3_BUCKET`, the task role's S3 policy and the
bucket in oxy-infra — goes only when `bucketRetirable` is also true: no
private document row names a bucket object any more (step 8) and the
`private_document` surface served nothing from the bucket for the soak.
