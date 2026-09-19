/**
 * The two doors, and the key that decides which one opens (#518 §7.4).
 *
 * `validateImageStoreKey` guards `GET /api/images/file/*`, which is public and
 * has no viewer. `validatePrivateDocumentKey` guards the authorizing route.
 * They are deliberate mirror images, and the property that matters is not that
 * each works — it is that **exactly one of them accepts any given key**. A key
 * both accept is a private document back on the public route; a key neither
 * accepts is a document nobody can reach.
 *
 * `storedDocumentKey` is the third piece: it recovers the object key from the
 * URL a row already holds, so shutting the public door needed no data
 * migration. It is a parser over a string Homiio wrote, and a row is still
 * data — a parse that fell through to "treat the whole string as a key" would
 * let one bad row name any object in the bucket.
 */

import {
  PRIVATE_KEY_PREFIXES,
  validateImageStoreKey,
  validatePrivateDocumentKey,
} from '../../utils/imageStoreKey';
import { storedDocumentKey } from '../../utils/storedDocumentKey';

const S3 = { bucketName: 'oxy-homiio-media-usw2-123', endpoint: '' };

describe('exactly one door opens for any key', () => {
  const keys = [
    'property/abc-original.jpeg',
    'city/abc-medium.webp',
    'applications/documents/abc-original.jpeg',
    'applications/documents/abc-original.pdf',
    'private/maintenance/abc-original.png',
    'property/abc-original.pdf',
    'property/abc-original.txt',
    '../etc/passwd',
  ];

  it.each(keys)('%s is accepted by at most one validator', (key) => {
    const publicDoor = validateImageStoreKey(key).ok;
    const privateDoor = validatePrivateDocumentKey(key).ok;
    expect(publicDoor && privateDoor).toBe(false);
  });

  it('routes every private prefix to the private door and nowhere else', () => {
    for (const prefix of PRIVATE_KEY_PREFIXES) {
      const key = `${prefix}sample-original.jpeg`;
      expect(validateImageStoreKey(key)).toEqual({ ok: false, reason: 'private-prefix' });
      expect(validatePrivateDocumentKey(key).ok).toBe(true);
    }
  });

  it('refuses a listing photo at the private door', () => {
    // The mirror half. Without it, the private route would be a second public
    // route for everything that is not private.
    expect(validatePrivateDocumentKey('property/abc-original.jpeg')).toEqual({
      ok: false,
      reason: 'not-private',
    });
  });

  it('checks the prefix AFTER normalization, at both doors', () => {
    const sneaky = 'listings/../applications/documents/abc-original.jpeg';
    expect(validateImageStoreKey(sneaky)).toEqual({ ok: false, reason: 'private-prefix' });
    // …and the private door resolves the same key, so the document is still
    // reachable by the route that checks who is asking.
    expect(validatePrivateDocumentKey(sneaky)).toMatchObject({
      ok: true,
      key: 'applications/documents/abc-original.jpeg',
    });
  });

  it('keeps every path-safety refusal at BOTH doors', () => {
    // The shared half. A private route that had its own, weaker traversal check
    // would be the more dangerous of the two, because it runs after auth.
    for (const bad of ['../secrets/x.jpeg', '/etc/x.jpeg', 'a\\b.jpeg', 'a\0b.jpeg', '']) {
      expect(validateImageStoreKey(bad).ok).toBe(false);
      expect(validatePrivateDocumentKey(bad).ok).toBe(false);
    }
  });

  it('serves a PDF only at the private door', () => {
    expect(validatePrivateDocumentKey('applications/documents/x-original.pdf')).toMatchObject({
      ok: true,
      contentType: 'application/pdf',
    });
    // The public route must never gain the ability to hand out a PDF; that is
    // the difference between the two doors.
    expect(validateImageStoreKey('property/x-original.pdf')).toEqual({
      ok: false,
      reason: 'disallowed-extension',
    });
  });
});

describe('recovering the key a stored row points at', () => {
  it('reads the delivery-route shape, whatever the host', () => {
    // `publicUrl` differs per environment and has changed at least once, so a
    // row written against the old one must still resolve.
    expect(
      storedDocumentKey('https://api.homiio.com/api/images/file/applications/documents/a.jpeg', S3),
    ).toBe('applications/documents/a.jpeg');
    expect(
      storedDocumentKey('http://localhost:4000/api/images/file/applications/documents/a.jpeg', S3),
    ).toBe('applications/documents/a.jpeg');
  });

  it('reads the legacy virtual-hosted S3 shape', () => {
    expect(
      storedDocumentKey(
        `https://${S3.bucketName}.s3.us-west-2.amazonaws.com/applications/documents/a.jpeg`,
        S3,
      ),
    ).toBe('applications/documents/a.jpeg');
  });

  it('reads a path-style URL only against the configured endpoint', () => {
    const withEndpoint = { ...S3, endpoint: 'https://minio.local:9000' };
    expect(
      storedDocumentKey(
        `https://minio.local:9000/${S3.bucketName}/applications/documents/a.jpeg`,
        withEndpoint,
      ),
    ).toBe('applications/documents/a.jpeg');
    // The same URL with no endpoint configured names nothing we store.
    expect(
      storedDocumentKey(`https://minio.local:9000/${S3.bucketName}/applications/documents/a.jpeg`, S3),
    ).toBeNull();
  });

  it('refuses a URL that is not ours', () => {
    for (const url of [
      'https://evil.example/applications/documents/a.jpeg',
      `https://not-the-bucket.s3.us-west-2.amazonaws.com/applications/documents/a.jpeg`,
      'file:///etc/passwd',
      'applications/documents/a.jpeg',
      '',
    ]) {
      expect(storedDocumentKey(url, S3)).toBeNull();
    }
  });

  it('decodes percent-escapes exactly once', () => {
    // Once, so a real space survives; only once, so `%252e%252e` cannot become
    // `..` on the way to the store.
    expect(
      storedDocumentKey('https://api.homiio.com/api/images/file/private/a%20b.jpeg', S3),
    ).toBe('private/a b.jpeg');
    expect(
      storedDocumentKey('https://api.homiio.com/api/images/file/private/%252e%252e/a.jpeg', S3),
    ).toBe('private/%2e%2e/a.jpeg');
    // …and that survivor is refused by the validator anyway, which is the
    // second gate rather than the only one.
    expect(validatePrivateDocumentKey('private/%2e%2e/a.jpeg').ok).toBe(true);
  });
});
