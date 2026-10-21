# Image uploads

A person's photo upload is stored as **their own public file in Oxy Files**
(ADR 0043). Homiio stores no bytes of its own: its S3 bucket was retired on
2026-10-21. The whole model — who owns each photo, references, file events,
private documents — is in [`docs/oxy-files.md`](../../../docs/oxy-files.md);
the code is `controllers/imageController.ts` and `services/files/publicImages.ts`.

## Endpoints

### `POST /api/images/upload` (authenticated)

`multipart/form-data` with one `image` file. JPEG, PNG, WebP or GIF, at most
10 MB. The photo is re-encoded with Sharp (EXIF and its GPS tag dropped) and
uploaded to the signed-in person's Oxy account. No `images` row is written yet:
the row is minted when the photo is published on a listing or a case, after Oxy
confirms the file is the publisher's own.

```json
{
  "success": true,
  "message": "Image uploaded successfully",
  "data": {
    "imageId": "<fileId>",
    "fileId": "<fileId>",
    "urls": {
      "small": "<Oxy rendition, w320>",
      "medium": "<Oxy rendition, w640>",
      "large": "<Oxy rendition, w1280>",
      "original": "<Oxy rendition, w2048>"
    },
    "metadata": { "originalSize": 1024000, "originalFormat": "jpeg", "uploadedAt": "…" },
    "keys": {
      "original": "oxy:<fileId>",
      "variants": { "original": "oxy:<fileId>", "small": "oxy:<fileId>", "medium": "oxy:<fileId>", "large": "oxy:<fileId>" }
    }
  }
}
```

`keys` keeps the shape app builds released before the move read; it carries
`oxy:<fileId>`, so a build that publishes `keys` publishes the right file.

### `POST /api/images/upload-multiple` (authenticated)

`multipart/form-data` with up to ten `images`. Every file is validated before
any is stored; the answer is `{ uploadedCount, images: [{ originalName, …the
single-upload data }] }`. A request may not carry more than
`UPLOAD_REQUEST_MAX_BYTES`, so the app splits a large set with
`planUploadBatches` (`docs/oxy-files.md`).

### `DELETE /api/images/:imageKey` (authenticated)

Deletes nothing and answers 200: an app build already in people's hands calls
it when a photo is removed from the picker, and the photo is the person's own
file in Oxy, to keep or delete there.

### `GET /api/images/file/*` (public) — the legacy door

Old photo URLs from before the move keep working: a 301 to the photo's Oxy
rendition, or a 404 (`services/files/legacyImages.ts`). Nothing is served from
Homiio itself.

## Publishing a photo

A listing's `images[]` names each photo by `imageId` (an existing row) or by its
Oxy file — `fileId`, or `keys.original = "oxy:<fileId>"` from an older app
build. Anything else is a 400 `INVALID_PROPERTY_IMAGE`
(`controllers/property/photoIntake.ts`).

## Refusals

- 400 — no file, a type that is not an image, or Oxy refused the type;
- 413 — the file is over 10 MB, or the person's Oxy storage is full;
- 451 — the bytes were taken down after a legal claim;
- 502 — Oxy could not store it for a reason that is Homiio's to look at.
