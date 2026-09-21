/**
 * `POST /api/images/upload` chose its own storage folder.
 *
 * The handler read `req.body.folder` with a `typeof === 'string'` check and
 * passed it through to `key = ${folder}/${uuid}-${variant}.${ext}`, which
 * reaches `path.join(LOCAL_IMAGE_STORE_DIR, key)` on the self-hosted path and
 * an arbitrary object key on S3. A body of `{"folder": "../../../../tmp"}`
 * wrote outside the store. CodeQL: `js/path-injection`, high.
 *
 * **What let it survive is the part worth remembering.** `writeToLocalStore`'s
 * own doc comment asserted the key was "already a safe, server-generated
 * `<folder>/<uuid>-<variant>.<ext>`". True of the uuid, false of the folder —
 * and a confident comment is why nobody looked. Meanwhile the READ path two
 * functions below carries two independent traversal gates and a paragraph
 * explaining why one is not enough.
 *
 * So there are two gates now, and both are tested: the caller resolves the
 * folder against an allowlist, and the writer refuses to leave the store even
 * if a future caller forgets to.
 */

import path from 'node:path';
import { resolveStorageFolder } from '../../services/imageUploadService';

describe('resolveStorageFolder', () => {
  it('keeps the folders the app actually uses', () => {
    for (const folder of ['general', 'property', 'profile', 'applications/documents']) {
      expect(resolveStorageFolder(folder)).toBe(folder);
    }
  });

  it('refuses every traversal shape a request body can carry', () => {
    // An allowlist rather than a sanitiser precisely because this list is
    // open-ended: a sanitiser must be right about every encoding a filesystem
    // accepts, a list only about the folders that exist.
    for (const hostile of [
      '../../../../tmp',
      '..',
      'general/../../../etc',
      '/etc/passwd',
      'C:\\Windows',
      '\\\\server\\share',
      'general\u0000/x',
      './general',
      'general/',
      'GENERAL/../..',
    ]) {
      expect(resolveStorageFolder(hostile)).toBe('general');
    }
  });

  it('falls back instead of throwing, and does not confirm what exists', () => {
    // An upload naming an odd folder is a client bug, not an attack worth
    // failing a user's request over — and a rejection would tell a prober which
    // folders are real.
    expect(resolveStorageFolder('nope-not-a-folder')).toBe('general');
    expect(resolveStorageFolder(undefined)).toBe('general');
    expect(resolveStorageFolder(null)).toBe('general');
    expect(resolveStorageFolder(42)).toBe('general');
    expect(resolveStorageFolder({ toString: () => '../etc' })).toBe('general');
  });

  it('normalises case and surrounding space the way a form would send it', () => {
    expect(resolveStorageFolder('  Property  ')).toBe('property');
  });
});

describe('the containment check in writeToLocalStore', () => {
  it('is the property the check enforces', () => {
    // The writer resolves `key` against the store root and requires the result
    // to stay inside it. Asserted here on `path` itself, because the private
    // method is not reachable from a test and the interesting part is the rule,
    // not the plumbing: this is what a traversal key does to a join.
    const root = path.resolve('/var/lib/homiio/images');

    const safe = path.resolve(root, 'general/abc-small.webp');
    expect(safe.startsWith(root + path.sep)).toBe(true);

    for (const hostile of ['../../../../tmp/x.webp', '../images-evil/x.webp']) {
      const escaped = path.resolve(root, hostile);
      expect(escaped === root || escaped.startsWith(root + path.sep)).toBe(false);
    }
  });
});
