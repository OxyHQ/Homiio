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
 * and a private document's key is built from the document's KIND and its
 * entity's id (`services/files/privateDocuments.ts`). This file pins the
 * second: whatever an id looks like, the key stays under `private/<kind>/`.
 */

import {
  MemoryObjectStore,
  setLegacyObjectStoreForTests,
} from '../../services/files/legacyObjectStore';
import { storePrivateFile } from '../../services/files/privateDocuments';
import { validatePrivateDocumentKey } from '../../utils/imageStoreKey';
import { fakeOxyFiles, oxyError } from '../helpers/fakeOxyFiles';

// Installed here rather than relied on from the jest setup, so the file runs
// the same under Bun's runner (`test:bun`), which has no setup files.
beforeAll(() => {
  setLegacyObjectStoreForTests(new MemoryObjectStore());
});

afterAll(() => {
  setLegacyObjectStoreForTests(null);
});

const PDF = Buffer.from('%PDF-1.4\n%fake\n');

describe('private document keys', () => {
  // A key is built only on the bucket path — what a document falls back to
  // when Oxy is down or refuses it — so Oxy is down here.
  beforeEach(() => {
    fakeOxyFiles.largeUploadError = oxyError(503, 'UNAVAILABLE');
  });

  it('are built from the kind and a real-looking entity id', async () => {
    const stored = await storePrivateFile(
      { ownerOxyUserId: 'user-1', kind: 'lease', entityId: '0192f4a2-aaaa-7bbb-8ccc-1234567890ab' },
      PDF,
      'application/pdf',
      '.pdf',
    );
    expect(stored.ref).toMatch(
      /^private\/leases\/0192f4a2-aaaa-7bbb-8ccc-1234567890ab\/[0-9a-f-]{36}\.pdf$/,
    );
    expect(validatePrivateDocumentKey(stored.ref).ok).toBe(true);
  });

  it('drop an entity id that is not plainly an id, instead of joining it', async () => {
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
        PDF,
        'application/pdf',
        '.pdf',
      );
      expect(stored.ref).toMatch(/^private\/maintenance\/[0-9a-f-]{36}\.pdf$/);
    }
  });

  it('record the digest of what was stored', async () => {
    const stored = await storePrivateFile(
      { ownerOxyUserId: 'user-1', kind: 'tenant_application' },
      PDF,
      'application/pdf',
      '.pdf',
    );
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.ref).toMatch(/^private\/applications\/[0-9a-f-]{36}\.pdf$/);
  });
});
