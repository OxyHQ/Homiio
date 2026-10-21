/**
 * An application's documents reach the server whole, in requests that each
 * stay under the API's per-request budget (`UPLOAD_REQUEST_MAX_BYTES`).
 *
 * Ten 10 MB documents used to travel in ONE multipart request — 100 MB, which
 * the proxy in front of the API refuses. `applicationService.create` now sends
 * what fits with the submission and attaches the rest to the new application.
 * What these pin: a set that fits is still exactly one request; a set that does
 * not is split in order with nothing dropped; and a failed attach withdraws the
 * application and rethrows, so the person sees the failed submission they
 * always saw, never an application quietly missing documents.
 */

import {
  APPLICATION_DOCUMENT_MAX_BYTES,
  EmploymentStatus,
  TenantApplicationDocumentType,
  TenantApplicationStatus,
  UPLOAD_REQUEST_ENVELOPE_BYTES,
  UPLOAD_REQUEST_MAX_BYTES,
} from '@homiio/shared-types';

import { type ApplicationDocumentUpload, applicationService } from '@/services/applicationService';
import { api } from '@/utils/api';

jest.mock('@/utils/api', () => {
  class ApiError extends Error {}
  return { api: { post: jest.fn(), patch: jest.fn() }, ApiError };
});

const mockedPost = api.post as jest.MockedFunction<typeof api.post>;
const mockedPatch = api.patch as jest.MockedFunction<typeof api.patch>;

const MIB = 1024 * 1024;

function documents(count: number, sizeBytes: number | undefined): ApplicationDocumentUpload[] {
  return Array.from({ length: count }, (_, index) => ({
    type: TenantApplicationDocumentType.INCOME,
    filename: `doc-${index}.pdf`,
    uri: `file:///cache/doc-${index}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes,
  }));
}

const input = (docs: ApplicationDocumentUpload[]) => ({
  propertyId: 'p1',
  moveInDate: '2026-12-01',
  leaseTermMonths: 12,
  monthlyIncome: 3800,
  employmentStatus: EmploymentStatus.EMPLOYED,
  referenceContacts: [],
  documents: docs,
});

/**
 * React Native's `FormData` keeps the `{ uri, name, type }` file descriptor it
 * is given; the test runtime's would stringify it. A recording stand-in keeps
 * the descriptor so the test can read which documents each request carried.
 */
class RecordingFormData {
  readonly parts: [string, unknown][] = [];
  append(name: string, value: unknown): void {
    this.parts.push([name, value]);
  }
}

/** The filenames a multipart body carries, in order. */
function filenamesIn(body: unknown): string[] {
  return (body as RecordingFormData).parts
    .filter(([name]) => name === 'documents')
    .map(([, value]) => (value as { name: string }).name);
}

const realFormData = global.FormData;
beforeAll(() => {
  global.FormData = RecordingFormData as unknown as typeof FormData;
});
afterAll(() => {
  global.FormData = realFormData;
});

const ok = (data: unknown) => ({ data: { success: true, data } }) as never;

beforeEach(() => {
  mockedPost.mockReset();
  mockedPatch.mockReset();
});

it('sends a set that fits in one request as exactly one request', async () => {
  mockedPost.mockResolvedValueOnce(ok({ id: 'a1', documents: [] }));
  await applicationService.create(input(documents(10, 2 * MIB)));
  expect(mockedPost).toHaveBeenCalledTimes(1);
  expect(mockedPost.mock.calls[0][0]).toBe('/api/applications');
  expect(filenamesIn(mockedPost.mock.calls[0][1])).toHaveLength(10);
});

it('splits ten full-size documents in order, attaching the rest to the new application', async () => {
  mockedPost.mockImplementation(async (url) => ok({ id: 'a1', url }));
  const docs = documents(10, APPLICATION_DOCUMENT_MAX_BYTES);
  const result = await applicationService.create(input(docs));

  const urls = mockedPost.mock.calls.map((call) => call[0]);
  expect(urls[0]).toBe('/api/applications');
  expect(urls.slice(1).every((url) => url === '/api/applications/a1/documents')).toBe(true);
  expect(urls.length).toBeGreaterThan(1);

  const sent = mockedPost.mock.calls.flatMap((call) => filenamesIn(call[1]));
  expect(sent).toEqual(docs.map((doc) => doc.filename));
  for (const call of mockedPost.mock.calls) {
    const bytes = filenamesIn(call[1]).length * APPLICATION_DOCUMENT_MAX_BYTES;
    expect(bytes).toBeLessThanOrEqual(UPLOAD_REQUEST_MAX_BYTES - UPLOAD_REQUEST_ENVELOPE_BYTES);
  }
  // The answer is the application as the LAST request left it.
  expect(result).toEqual({ id: 'a1', url: '/api/applications/a1/documents' });
  expect(mockedPatch).not.toHaveBeenCalled();
});

it('plans a document of unknown size at the per-document cap', async () => {
  mockedPost.mockImplementation(async () => ok({ id: 'a1' }));
  await applicationService.create(input(documents(10, undefined)));
  expect(mockedPost.mock.calls.length).toBeGreaterThan(1);
  expect(mockedPost.mock.calls.flatMap((call) => filenamesIn(call[1]))).toHaveLength(10);
});

it('withdraws the application and rethrows when attaching the rest fails', async () => {
  const failure = new Error('network down');
  mockedPost.mockResolvedValueOnce(ok({ id: 'a1' })).mockRejectedValueOnce(failure);
  mockedPatch.mockResolvedValueOnce(ok({ id: 'a1', status: 'withdrawn' }));

  await expect(
    applicationService.create(input(documents(10, APPLICATION_DOCUMENT_MAX_BYTES))),
  ).rejects.toBe(failure);
  expect(mockedPatch).toHaveBeenCalledWith('/api/applications/a1', {
    status: TenantApplicationStatus.WITHDRAWN,
  });
});
