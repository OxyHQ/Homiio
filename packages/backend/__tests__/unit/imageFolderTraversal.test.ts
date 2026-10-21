/**
 * No request chooses where bytes are stored.
 *
 * `POST /api/images/upload` used to take its storage folder from
 * `req.body.folder` and build an object key from it — `{"folder":
 * "../../../../tmp"}` wrote outside the local store (CodeQL
 * `js/path-injection`, high), and on S3 to any prefix. The fix at the time was
 * an allowlist. The root is gone now: a public photo goes to the uploader's
 * Oxy account and Homiio builds no key for it at all
 * (`__tests__/integration/imageUpload.test.ts` asserts `folder` is ignored),
 * and a private document goes to the uploader's Oxy account too — or nowhere:
 * there is no bucket path left to build a key for
 * (`services/files/privateDocuments.ts`). This file pins the second: whatever
 * an entity id looks like, nothing of it reaches storage, and an Oxy that will
 * not store the document fails the upload instead of writing to the bucket.
 */

import { AppError } from '../../middlewares/errorHandler';
import {
  MemoryObjectStore,
  setLegacyObjectStoreForTests,
} from '../../services/files/legacyObjectStore';
import { setOxyFilesForTests } from '../../services/files/oxyFilesSeam';
import {
  setPrivateDocumentSleepForTests,
  storePrivateFile,
} from '../../services/files/privateDocuments';
import { fakeOxyFiles, oxyError } from '../helpers/fakeOxyFiles';

const bucket = new MemoryObjectStore();

// Installed here rather than relied on from the jest setup, so the file runs
// the same under Bun's runner (`test:bun`), which has no setup files.
beforeAll(() => {
  setLegacyObjectStoreForTests(bucket);
  setOxyFilesForTests(fakeOxyFiles.api());
  setPrivateDocumentSleepForTests(() => Promise.resolve());
});

afterAll(() => {
  setLegacyObjectStoreForTests(null);
  setOxyFilesForTests(null);
  setPrivateDocumentSleepForTests(null);
});

beforeEach(() => {
  fakeOxyFiles.reset();
  bucket.objects.clear();
});

const PDF = Buffer.from('%PDF-1.4\n%fake\n');

describe('private documents', () => {
  it('go to the uploader’s Oxy account, named by their kind and nothing a caller sent', async () => {
    for (const hostile of [
      '../../../../tmp',
      '..',
      'a/../../etc',
      '/etc/passwd',
      'C:\\Windows',
      'id\u0000x',
      'x'.repeat(65),
    ]) {
      const stored = await storePrivateFile(
        { ownerOxyUserId: 'user-1', kind: 'maintenance_request', entityId: hostile },
        Buffer.concat([PDF, Buffer.from(hostile)]),
        'application/pdf',
        '.pdf',
      );
      expect(stored.ref).toMatch(/^oxy:[A-Za-z0-9_-]+$/);
    }
    const uploads = fakeOxyFiles.callsOf('uploadUserMediaLarge');
    expect(uploads).toHaveLength(7);
    for (const args of uploads) {
      expect(args[1]).toMatchObject({
        filename: 'maintenance_request.pdf',
        visibility: 'private',
      });
    }
    expect(bucket.objects.size).toBe(0);
  });

  it('record the digest of what was stored', async () => {
    const stored = await storePrivateFile(
      { ownerOxyUserId: 'user-1', kind: 'tenant_application' },
      PDF,
      'application/pdf',
      '.pdf',
    );
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fakeOxyFiles.files.get(stored.ref.slice(4))?.sha256).toBe(stored.sha256);
  });

  it('are never written to the bucket when Oxy cannot store them', async () => {
    fakeOxyFiles.largeUploadError = oxyError(503, 'UNAVAILABLE');

    const failure = await storePrivateFile(
      { ownerOxyUserId: 'user-1', kind: 'lease', entityId: '0192f4a2-aaaa-7bbb-8ccc-1234567890ab' },
      PDF,
      'application/pdf',
      '.pdf',
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ statusCode: 503, code: 'DOCUMENT_STORAGE_UNAVAILABLE' });
    expect(bucket.objects.size).toBe(0);
  });
});
