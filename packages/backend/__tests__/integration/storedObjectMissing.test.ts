/**
 * A missing image is a 404, from either store.
 *
 * ## What was happening in production
 *
 * `GET /api/images/file/*` documents its own contract: "a missing/forbidden
 * file is a flat 404 so the route leaks neither paths nor existence of
 * out-of-store files". It held for the local store and not for S3, because the
 * classifier tested `ENOENT`/`ENOTDIR` — filesystem codes that S3 never raises.
 * So every request for a key that is not there escaped as an exception and the
 * route answered **500**. Verified against production: an absent
 * `property/...` key returned 500.
 *
 * ## Why this is a unit test over error shapes
 *
 * The condition is "what does the store raise when the object is not there",
 * and the local store cannot raise an S3 error. Reproducing it end to end would
 * mean standing up S3 or mocking the client's internals — the first is not
 * available here and the second asserts the mock. What matters is the CLASSIFIER,
 * and its inputs are three documented error shapes.
 */

import express, { type Express } from 'express';
import request from 'supertest';

import imageController from '../../controllers/imageController';
import imageUploadService from '../../services/imageUploadService';
import { errorHandler } from '../../middlewares/errorHandler';

function publicImages(): Express {
  const app = express();
  app.get('/images/file/*', (req, res) => imageController.serveLocalImage(req, res));
  app.use(errorHandler);
  return app;
}

/** The private method under test, reached without widening its visibility. */
const isMissing = (error: unknown): boolean =>
  (imageUploadService as unknown as { isFileMissingError(e: unknown): boolean })
    .isFileMissingError(error);

describe('what counts as "there is no such object"', () => {
  it('still recognises the local store', () => {
    expect(isMissing(Object.assign(new Error('nope'), { code: 'ENOENT' }))).toBe(true);
    expect(isMissing(Object.assign(new Error('nope'), { code: 'ENOTDIR' }))).toBe(true);
  });

  it('recognises what S3 raises for an absent key', () => {
    // The shape the SDK gives when the role MAY list the bucket.
    expect(isMissing(Object.assign(new Error('x'), { name: 'NoSuchKey' }))).toBe(true);
    expect(isMissing(Object.assign(new Error('x'), { name: 'NotFound' }))).toBe(true);
    expect(
      isMissing(Object.assign(new Error('x'), { $metadata: { httpStatusCode: 404 } })),
    ).toBe(true);
  });

  it('counts AccessDenied as missing, because that is what S3 says', () => {
    // Without `s3:ListBucket` — which this role does not need and should not
    // have — S3 answers AccessDenied for an object that is not there, so that a
    // stranger cannot probe which keys exist. That is the COMMON case here, and
    // it is the one that was producing 500s.
    expect(isMissing(Object.assign(new Error('x'), { name: 'AccessDenied' }))).toBe(true);
    expect(
      isMissing(Object.assign(new Error('x'), { $metadata: { httpStatusCode: 403 } })),
    ).toBe(true);
  });

  it('does NOT swallow a real failure', () => {
    // The floor. A classifier that answered true for everything would turn
    // every outage into a silent empty page, which is worse than the 500 it
    // replaced.
    expect(isMissing(Object.assign(new Error('boom'), { name: 'TimeoutError' }))).toBe(false);
    expect(
      isMissing(Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 500 } })),
    ).toBe(false);
    expect(isMissing(new Error('boom'))).toBe(false);
    expect(isMissing(null)).toBe(false);
    expect(isMissing('nope')).toBe(false);
  });
});

describe('the route answers its own contract', () => {
  it('404s a key that is not in the store', async () => {
    const res = await request(publicImages()).get(
      '/images/file/property/definitely-not-here-original.jpeg',
    );

    expect(res.status).toBe(404);
  });

  it('still 400s a key it refuses to consider at all', async () => {
    // The refusals stay distinct from absence: a private prefix and a traversal
    // are not "no such image", and collapsing them into 404 would lose the
    // difference between a key we will not serve and one we do not have.
    expect(
      (await request(publicImages()).get('/images/file/applications/documents/x-original.jpeg'))
        .status,
    ).toBe(400);
    expect(
      (await request(publicImages()).get('/images/file/property/x-original.txt')).status,
    ).toBe(400);
  });
});
