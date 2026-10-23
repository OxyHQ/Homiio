# Photos and documents: Oxy Files

> The platform model is Oxy's ADR 0043 ("Who owns a file, who uses it, and
> when it goes away"). This page says how Homiio applies it, and records how
> Homiio's own bucket was retired (2026-10-21).

Homiio stores no bytes of its own. Every photo it shows
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

### How big one upload request may be

No request to the API carries more than `UPLOAD_REQUEST_MAX_BYTES` (64 MB,
`shared-types/src/upload.ts`): the API sits behind a proxy that refuses bodies
over 100 MB, and `upload-multiple` and an application's submission each accept
ten 10 MB files. `server.ts` refuses a larger declared `Content-Length` with a
413 JSON body before reading it, and the multi-file routes refuse files that
total more after multer (`middlewares/uploadBudget.ts`). The app splits a set
with `planUploadBatches` — the photo picker sends one request per batch, and an
application sends what fits with the submission and attaches the rest through
`POST /api/applications/:id/documents`; if that fails it withdraws the
application, so no landlord is left reviewing one missing documents the person
picked, and the person can send it again. The per-file and per-set limits did
not change.

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
  (with the original requester proof). A PDF goes verbatim, a photo re-encoded first
  (EXIF and GPS dropped). The row holds `oxy:<fileId>`
  (`lease_documents.url`, `tenant_application_documents.url`,
  `maintenance_request_attachments.storage_key`), and
  `lease_documents.content_sha256` is the digest Oxy verified. A private file
  never reaches `public/` or the CDN.
- **Read back** with `linkedDownloadUrls([fileId])` (under the existing resource entitlement) —
  allowed because Homiio stored the file FOR the person, which Oxy records as
  their consent. The short-lived URL is fetched on the server and never leaves
  it; the bytes must hash to what Oxy recorded. Who may read is still Homiio's
  party check in `domain/*` (lease parties, the application's applicant and
  landlord, the maintenance request's lease parties); Oxy's consent only says
  Homiio may read the file. When the person revokes Homiio's access in their
  file manager, or the file is trashed, deleted or taken down, Oxy leaves it
  out and the route answers 404. A re-upload of bytes whose access was revoked
  answers 409 `DOCUMENT_ACCESS_REVOKED` (the revocation survives the
  re-upload, and is honoured).
- **Referenced**: the document row is the use. Migration
  `0038_oxy_private_documents` marks the pair on every insert, update and
  delete (cascades included); the drain registers it and the nightly
  reconciliation covers the three types (`referenceUsage.ts`).
- **A client never names one.** A listed application document is a link the
  applicant supplies; one naming a stored document (`oxy:…`) is refused with
  400 `INVALID_DOCUMENTS`, because the document route reads through Homiio's
  own access.

**Where a new one goes.** Every new document goes to Oxy, and nowhere else.
When Oxy will not hold it, the
upload fails and says why (`privateDocuments.ts`): a transient failure (Oxy
unreachable, a 5xx, a damaged transfer) is retried twice and a short rate limit
waited out once, then answers 503; the person's own case answers what they can
act on — 413 `STORAGE_QUOTA_EXCEEDED` (their Oxy storage is full), 413/415 (too
large, a type Oxy will not hold), 451 `DOCUMENT_BLOCKED`, or 409
`DOCUMENT_ACCESS_REVOKED` (they removed Homiio's access to these exact bytes,
and that decision is honoured rather than routed around); a refusal of
Homiio's own credential or an answer that is not the private file sent is
logged as an error and answers 503/502. No row is written for a failed upload.
A row's ref is `oxy:<fileId>` and nothing else; a row naming anything else
reads as absent (404).

## Rollout

As it ran, in this order. Nothing here runs against production from a
developer machine; the scripts run as one-off ECS tasks of the API image.

1. **Oxy:** the API deploy carrying ADR 0043 stages 1–4b, and `@oxy.so/contracts`
   4.24.0, `@oxy.so/core` 4.21.0 and `@oxy.so/services` 11.12.0 published.
   Stage 4c (OxyHQ/oxy#1774) for private documents.
2. **Workload and requester provenance (Oxy ADR 0049).** Homiio's registered
   workload and environment identify the service; own calls need no application
   scopes or grants. Personal uploads additionally carry the initiating shared
   session or verified capability ticket. External MCP document tools preserve
   their original live OAuth connection, active account and housing permissions;
   the shared document facade permits only private uploads up to 10 MiB.
   Resource references and revocable file-read entitlements remain in force.
3. **The webhook secret.** Create `/oxy/homiio/OXY_FILES_WEBHOOK_SECRET`
   (SecureString, any placeholder) — the task definition names its ARN and a
   task does not start without it. Deploy. In the Oxy console (Homiio →
   Webhooks → File events) set `https://api.homiio.com/webhooks/oxy/files`; the
   challenge is answered without the secret. Put the `whsec_…` it shows into the
   parameter and force a new deployment of the API service.
4. **Migrations `0037_oxy_files` and `0038_oxy_private_documents`** (both
   `pre`) are applied by the deploy.
5. **Orphans:** `scripts/cleanOrphanImages.ts` (preview), then `--apply`.
6. **Copy, soak and private documents — done.** Every shown photo was copied
   into Oxy Files and every private document moved into its owner's account;
   the CLIs that did it were deleted with the bucket
   ([The bucket, retired](#the-bucket-retired-2026-10-21)).
7. **References:** `scripts/reconcileFileReferences.ts` (dry run), read it,
   then `--apply`. Run it before Oxy's unused-file sweep is enforced for
   Homiio: an application file Homiio shows but never referenced reads as
   unused there.

## The bucket, retired (2026-10-21)

Homiio's own S3 bucket (`oxy-homiio-media-usw2-…`) held every photo and
private document before ADR 0043. The copy into Oxy Files ran to completion
(`migrateImagesToOxy` for the photos, `migratePrivateDocumentsToOxy` for the
documents), and on 2026-10-21 production measured, read-only:

- `images`: 2,188,197 rows, every one naming an Oxy file; no `urls_*` value
  pointing at the legacy door or at S3, and none in `property_images.url`;
- `lease_documents`, `tenant_application_documents`,
  `maintenance_request_attachments`: no row naming a bucket object; no bucket
  or legacy-door URL in `eviction_cases.cover_image_url`, `reviews.images`,
  `lease_inspection_findings.photos` or `property_documents.url`;
- `legacy_media_reads`: the last `public_image`/`served` read was the copy's
  own (2026-10-19, ~03:00 UTC), and the API's request logs show no
  `/api/images/file/` request since 2026-10-19, 04:00 UTC.

The owner waived the rest of the planned 14-day soak, and one change retired
the bucket from the code:

- the legacy door (`legacyImages.resolveLegacyImage`) answers redirects and
  404s only — an old `/api/images/file/<key>` URL still answers 301 to its Oxy
  rendition, or 404; nothing is read from the bucket;
- a private document is `oxy:<fileId>` or nothing (`privateDocuments.ts`);
- a listing photo is published by `imageId` or by its Oxy file; bucket keys are
  a 400 (`photoIntake.ts`);
- the object-store adapter, the two copy CLIs, the retirement gate
  (`oxyFilesStatus`), the `s3` config block, `AWS_S3_BUCKET` and the AWS SDK
  went; the deploy removes `AWS_S3_BUCKET` and `PUBLIC_API_URL` from the
  running task definitions;
- migration `0039_retire_legacy_bucket` (`post`) dropped `images.keys_small`,
  `keys_medium` and `keys_large`, made `images_storage_check` require the Oxy
  file, and narrowed `maintenance_request_attachments_private_key_check` to
  `oxy:` refs. `keys_original` stays: it is the door's redirect lookup.

`legacy_media_reads` still counts the door's `public_image` `redirected` and
`missing` answers, zeros included (`legacyReadCounter.ts`). When the redirects
stop, the door itself can go. The bucket, the task role's S3 policy and the
bucket in oxy-infra are retired outside this repository.

## Own authority migration release gate

The prepared backend uses core's `withRequester` and the subsequent
`withMcpDocumentRequester` addition, plus the Allo SDK server factory. Publish
and pin those shared packages and deploy the matching Oxy document mediator
before this Homiio image. The core 7.0 foundation alone does not yet export the
new document facade; it belongs to the following shared SDK/API release.
Local candidate tarballs are validation artifacts and must never be committed.
The shared Oxy sign-in is unchanged for people; there is no app connection prompt.
