/**
 * The public photo door never answers for a private document's old key
 * (#518 §7.4).
 *
 * `validateImageStoreKey` guards `GET /api/images/file/*`, which is public and
 * has no viewer. Homiio's bucket is retired and the door now only redirects
 * public photos to Oxy, but the keys of tenancy evidence are still refused
 * outright — however they are spelled — so the door can never be asked about
 * one. Private documents are read only through their authorizing routes, from
 * Oxy (`services/files/privateDocuments.ts`).
 */

import { PRIVATE_KEY_PREFIXES, validateImageStoreKey } from '../../utils/imageStoreKey';

describe('the public door refuses every private key', () => {
  it('refuses every private prefix', () => {
    for (const prefix of PRIVATE_KEY_PREFIXES) {
      expect(validateImageStoreKey(`${prefix}sample-original.jpeg`)).toEqual({
        ok: false,
        reason: 'private-prefix',
      });
    }
  });

  it('accepts an ordinary listing photo key', () => {
    // The floor: a gate that refused everything would pass the case above.
    expect(validateImageStoreKey('property/abc-original.jpeg')).toMatchObject({
      ok: true,
      key: 'property/abc-original.jpeg',
      contentType: 'image/jpeg',
    });
  });

  it('checks the prefix AFTER normalization', () => {
    const sneaky = 'listings/../applications/documents/abc-original.jpeg';
    expect(validateImageStoreKey(sneaky)).toEqual({ ok: false, reason: 'private-prefix' });
  });

  it('keeps every path-safety refusal', () => {
    for (const bad of ['../secrets/x.jpeg', '/etc/x.jpeg', 'a\\b.jpeg', 'a\0b.jpeg', '']) {
      expect(validateImageStoreKey(bad).ok).toBe(false);
    }
  });

  it('never answers for a PDF', () => {
    expect(validateImageStoreKey('property/x-original.pdf')).toEqual({
      ok: false,
      reason: 'disallowed-extension',
    });
  });
});
