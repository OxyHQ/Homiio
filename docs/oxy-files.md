# Photos and documents: Oxy Files

> The platform model is Oxy's ADR 0043 ("Who owns a file, who uses it, and
> when it goes away"). This page says how Homiio applies it, how the move off
> Homiio's own bucket runs, and what has to be true before the bucket goes.

Homiio stores no public photo bytes of its own any more. Every photo it shows
is a file in **Oxy Files**, and Homiio keeps only its record of showing it (an
`images` row naming `oxy_file_id`) and the four rendition URLs Oxy serves.
Private tenancy documents are the one exception, and they wait on Oxy (see
[Private documents](#private-documents-waiting-on-oxy-stage-4c)).

## Who owns what

| What | Owner (ADR 0043 D1) | Enters through | Used by (reference `entityType` / `entityId`) |
|---|---|---|---|
| A host's listing photo | the **host's account** | `POST /api/images/upload` → `uploadUserMedia` (EXIF stripped first); minted into `images` at publish after Oxy confirms the file is the publisher's own | `property` / listing id |
| A scraped listing photo | the **Homiio application** | `ExternalMediaIngest` → `importAppFiles` (Oxy fetches it; the same URL is never downloaded twice) | `property` / listing id |
| A Wikimedia city cover | the **Homiio application** | `cityCoverSyncService` → `importAppFile`, credit from Commons `extmetadata` stored on the row (`attribution_*`) and served with the cover | `city` / city id |
| An eviction case cover | the **organiser's account** | `POST /api/images/upload`, resolved by `controllers/eviction/coverImage.ts` | `eviction_case` / case id |
| A region cover | the **Homiio application** | (nothing writes one today) | `region` / region id |
| Lease, application and maintenance documents | the **uploader's account**, PRIVATE — *not yet* | `services/files/privateDocuments.ts`, still Homiio's bucket | — (TODO(oxy-4c)) |

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

- **Triggers mark, the drain decides.** Migration `0036_oxy_files` installs
  triggers on `property_images`, `cities`, `regions`, `eviction_cases` and
  `images` that mark every pair a write could have moved, in the transaction of
  the write (`file_reference_changes`; cascades included). The drain
  (`services/files/referenceSync.ts`, every API task, every 10 s) reads the
  PRESENT answer and adds or removes the reference, so the order of changes
  cannot leave a wrong state. A failed call backs off to six hours and stays
  visible (`attempts`, `last_error`).
- **Nightly reconciliation** (`referenceReconcile.ts`, 04:10 UTC, one task per
  type) sends Oxy the full inventory per entity type from one snapshot, then
  re-marks the pairs the drain settled during it.
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

## Private documents (waiting on Oxy stage 4c)

`services/files/privateDocuments.ts` is the ONE module that stores and reads a
lease document, an application document or a maintenance photo. Today's Oxy
cannot hold them: a service upload into a person's account is public-only and
image/video-only, and a service may only read back a private file whose owner
referenced it from their own session. Until stage 4c the bytes stay under
`private/` in Homiio's bucket — PDFs verbatim, photos re-encoded — and every
read is counted (`legacy_media_reads`, `private_document`). The 4c switch, and
the copy of the existing documents, change that one module and nothing else;
its `TODO(oxy-4c)` says exactly how.

## Rollout

In this order. Nothing here runs against production from a developer machine;
the scripts run as one-off ECS tasks of the API image.

1. **Oxy:** the API deploy carrying ADR 0043 stages 1–4b (in production), and
   `@oxy.so/contracts` 4.22.0, `@oxy.so/core` 4.18.0 and `@oxy.so/services`
   11.9.0 published. Stage 4c (private person media) is NOT needed: nothing
   here calls it, and the private documents stay in the bucket until it ships.
2. **Exact service-token scopes, then the grant.** Sindi's canary
   (`services/oxy.ts`, `assertCanonicalSindiServiceToken`) requires the attested
   token's scopes to be EXACTLY `inference:invoke` + `acting-as:offline`, and the
   file calls attest as the same workload. So Sindi's client asks Oxy for exactly
   that subset (`SINDI_SERVICE_TOKEN_SCOPES`, `serviceToken(…, { scopes })`,
   core 4.18.0 — Oxy #1718), and only the unnarrowed backend lane carries
   whatever else the application holds. Deploy THIS first; only then do Oxy
   staff grant the Homiio application and its workload binding `files:read`,
   `files:app:write`, `files:references:write` and `files:user-media:write`.
   Granted to a Homiio still minting unnarrowed Sindi tokens, they break Sindi.
3. **The webhook secret.** Create `/oxy/homiio/OXY_FILES_WEBHOOK_SECRET`
   (SecureString, any placeholder) — the task definition names its ARN and a
   task does not start without it. Deploy. In the Oxy console (Homiio →
   Webhooks → File events) set `https://api.homiio.com/webhooks/oxy/files`; the
   challenge is answered without the secret. Put the `whsec_…` it shows into the
   parameter and force a new deployment of the API service.
4. **Migration `0036_oxy_files`** (`pre`) is applied by the deploy.
5. **Orphans:** `scripts/cleanOrphanImages.ts` (preview), then `--apply`.
6. **Copy:** `scripts/migrateImagesToOxy.ts` (preview), then `--apply
   --report=…` until the preview reports nothing left. Read the
   `missing_object` lines (a shown photo whose object is gone — broken today)
   and re-run with `--detach-missing`. Legacy city covers are re-sourced with
   credit, or cleared if Commons cannot credit them; a region cover is cleared.
   The report carries row ids, outcomes and SHA-256s, never keys or URLs.
7. **Soak.** The legacy door keeps every old URL working: a migrated photo's
   old URL answers 301 to its Oxy rendition, an unmigrated one is still served
   from the bucket. `scripts/oxyFilesStatus.ts` prints the gate daily.

## Retiring the bucket

`scripts/oxyFilesStatus.ts` exits 0 only when **the public half may go**: no
shown photo left in the bucket, zero `public_image`/`served` reads for 14 days,
and the counter itself at least 14 days old (so an absence of rows cannot pass
for an absence of reads). Then, in one change:

- `legacyImages.resolveLegacyImage` answers redirects and 404s only (drop the
  bucket read), and `migrateImagesToOxy.ts` is deleted;
- a `post` migration drops `images.keys_*` except `keys_original` (the
  redirect's lookup key) and `images_storage_check` requires `oxy_file_id`.

The bucket itself — and `AWS_S3_BUCKET`, the task role's S3 policy and the
bucket in oxy-infra — goes only when `bucketRetirable` is also true, i.e. after
the private documents have moved (Oxy stage 4c, `privateDocuments.ts`).
