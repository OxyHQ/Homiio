/**
 * Opening a document that needs the session (#518 §7.4).
 *
 * ## Why this is not `Linking.openURL`
 *
 * It used to be. An application's documents carried an absolute URL to
 * `/api/images/file/<key>` — the same unauthenticated route that serves listing
 * photos — so opening one was a plain link, and so was opening one you had no
 * business seeing. The objects live in a private bucket; that route was the
 * whole of what made a tenant's payslip public.
 *
 * The bytes now come from a handler that checks who is asking, which means they
 * arrive through the API client rather than through the browser's own address
 * bar. `Linking.openURL` and `window.open` cannot carry the session, so they
 * cannot be the way this opens any more.
 *
 * ## Why base64 and not a stream
 *
 * The Oxy linked client owns auth and is JSON-only, and `AGENTS.md` forbids
 * adding a second manual token path — so a binary `fetch` with a bearer is not
 * available. The server answers with the bytes base64-encoded inside the
 * ordinary envelope, bounded by the same 10 MB cap the upload has. A signed
 * short-lived URL would be the usual answer and needs a signing secret; that is
 * a separate change and not a reason to leave the documents on a public route
 * in the meantime.
 */

import { Platform } from 'react-native';

import { api, type ApiResponse } from '@/utils/api';

/** What the private-document endpoint answers with. */
export interface PrivateDocument {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  /** The document's bytes, base64. */
  readonly base64: string;
}

/**
 * Fetch one private document through the authenticated API.
 *
 * `downloadPath` comes from the row the server serialized — never assembled at
 * the call site, so a screen cannot ask for a path the server did not offer.
 */
export async function fetchPrivateDocument(downloadPath: string): Promise<PrivateDocument> {
  const { data } = await api.get<ApiResponse<PrivateDocument>>(downloadPath);
  if (!data.data) throw new Error('The document response carried no bytes.');
  return data.data;
}

/**
 * Turn base64 into the bytes a Blob wants.
 *
 * Exported and pure so the decoding is testable without a DOM: `atob` exists on
 * web and in Hermes, and a wrong chunking here would produce a file that opens
 * as garbage rather than failing.
 */
export function bytesFromBase64(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Fetch a private document and hand it to the platform to open.
 *
 * On web the bytes become an object URL opened in a new tab, and the URL is
 * revoked once the tab has had it: an object URL is readable by any script on
 * this origin for as long as it exists, and nothing here needs it to outlive
 * the click.
 *
 * On native the bytes are written into the app's own cache directory and handed
 * to the share sheet, which is how a phone opens a file it did not download
 * through a browser. The cache directory is app-private; the file keeps the
 * server-sanitised filename so the sheet shows something a person recognises.
 *
 * Throws on any failure so the caller shows its own message — a silent
 * catch here would look exactly like a button that does nothing.
 */
export async function openPrivateDocument(downloadPath: string): Promise<void> {
  const document = await fetchPrivateDocument(downloadPath);

  if (Platform.OS === 'web') {
    const blob = new Blob([bytesFromBase64(document.base64) as BlobPart], {
      type: document.contentType,
    });
    const url = URL.createObjectURL(blob);
    try {
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) throw new Error('The browser refused to open the document.');
    } finally {
      // Long enough for the new tab to have taken it, short enough that the
      // bytes are not left readable on this origin for the session.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    return;
  }

  // Imported lazily so the web bundle never pulls the native modules in, and
  // so a screen that only LISTS documents costs nothing for the one that opens.
  const [{ File, Paths, EncodingType }, Sharing] = await Promise.all([
    import('expo-file-system'),
    import('expo-sharing'),
  ]);

  if (!(await Sharing.isAvailableAsync())) {
    // Checked BEFORE writing: a device that cannot open the file has no reason
    // to end up holding a copy of somebody's payslip in its cache.
    throw new Error('This device cannot open the document.');
  }

  const file = new File(Paths.cache, document.filename);
  // `write` creates the file; a previous open of the same document leaves one
  // behind, and overwriting is what makes a second tap show the same bytes
  // rather than fail.
  file.write(document.base64, { encoding: EncodingType.Base64 });
  await Sharing.shareAsync(file.uri, { mimeType: document.contentType });
}
