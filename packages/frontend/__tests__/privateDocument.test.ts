/**
 * Opening a document that needs the session (#518 §7.4).
 *
 * An application's documents used to carry an absolute URL to
 * `/api/images/file/<key>` — the unauthenticated route that also serves listing
 * photos — so a tenant's payslip opened with a plain `window.open` and kept
 * opening, for anyone, forever. The bytes now come from a handler that checks
 * who is asking.
 *
 * These cover the two things that can go wrong on this side and have no other
 * way of being noticed: asking the wrong endpoint, and decoding the bytes
 * incorrectly — which produces a file that opens as garbage rather than an
 * error anybody sees.
 *
 * The platform hand-off itself (an object URL on web, the share sheet on a
 * phone) is not exercised here and is stated as unverified in the change that
 * introduced it, rather than covered by a test that only asserts a mock.
 */

import { bytesFromBase64, fetchPrivateDocument } from '@/utils/privateDocument';
import { api } from '@/utils/api';

jest.mock('@/utils/api', () => ({
  api: { get: jest.fn() },
}));

const mockedGet = api.get as jest.MockedFunction<typeof api.get>;

describe('fetching a private document', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('asks for the path the SERVER offered, verbatim', async () => {
    mockedGet.mockResolvedValue({
      data: {
        success: true,
        data: { id: 'd1', filename: 'payslip.jpeg', contentType: 'image/jpeg', base64: 'AAAA' },
      },
    });

    await fetchPrivateDocument('/api/applications/a1/documents/d1');

    // Never assembled at the call site: a screen cannot ask for a path the
    // server did not put in the row it serialized.
    expect(mockedGet).toHaveBeenCalledWith('/api/applications/a1/documents/d1');
  });

  it('throws rather than returning an empty document', async () => {
    mockedGet.mockResolvedValue({ data: { success: true } });

    // A caller that got `undefined` here would write a zero-byte file and call
    // it a success.
    await expect(fetchPrivateDocument('/api/applications/a1/documents/d1')).rejects.toThrow();
  });

  it('propagates a refusal instead of swallowing it', async () => {
    mockedGet.mockRejectedValue(new Error('Document not found'));

    await expect(fetchPrivateDocument('/api/applications/a1/documents/d1')).rejects.toThrow(
      'Document not found',
    );
  });
});

describe('decoding the bytes', () => {
  it('round-trips every byte value', () => {
    // Bytes above 0x7f are where a naive `charCodeAt` over a decoded string
    // goes wrong, and the symptom is a file that opens as garbage — not an
    // error anybody sees.
    const original = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) original[index] = index;
    const base64 = Buffer.from(original).toString('base64');

    expect(Array.from(bytesFromBase64(base64))).toEqual(Array.from(original));
  });

  it('decodes a short payload whose length is not a multiple of three', () => {
    // The padded cases, where a wrong chunking silently drops a trailing byte.
    for (const text of ['a', 'ab', 'abc', 'abcd']) {
      const bytes = bytesFromBase64(Buffer.from(text).toString('base64'));
      expect(Buffer.from(bytes).toString()).toBe(text);
    }
  });
});
