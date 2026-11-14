import type { Request } from 'express';
import { redactCredentials } from '../../middlewares/logging';
import { setOxyFilesForTests } from '../../services/files/oxyFilesSeam';
import {
  personalDocumentFiles,
  sessionActingFor,
  sessionFileRequester,
} from '../../services/files/requester';
import { fakeOxyFiles } from '../helpers/fakeOxyFiles';

beforeAll(() => setOxyFilesForTests(fakeOxyFiles.api()));
afterAll(() => setOxyFilesForTests(null));
beforeEach(() => fakeOxyFiles.reset());

function sessionRequest(fields: Record<string, unknown>): Request {
  return fields as unknown as Request;
}

test('redacts credentials while keeping operation metadata', () => {
  const result = redactCredentials({
    req: {
      headers: {
        authorization: 'Bearer secret',
        'x-oxy-mcp-media-token': 'connection',
      },
      body: { connectionToken: 'original', subjectToken: 'shared' },
    },
    operation: 'uploadLeaseDocument',
  });
  const serialized = JSON.stringify(result);
  for (const value of ['Bearer secret', 'original', 'shared', 'connection'])
    expect(serialized).not.toContain(`:"${value}"`);
  expect(result).toMatchObject({
    operation: 'uploadLeaseDocument',
    req: { body: { connectionToken: '[REDACTED]', subjectToken: '[REDACTED]' } },
  });
});

test('a person acts for their own account, and for an account they operate as its requester', () => {
  expect(sessionActingFor(sessionRequest({ user: { id: 'person' } }))).toEqual({
    accountId: 'person',
  });
  expect(
    sessionActingFor(
      sessionRequest({
        user: { id: 'organization' },
        oxyActor: {
          actorAccountId: 'person',
          effectiveAccountId: 'organization',
          delegated: true,
        },
      }),
    ),
  ).toEqual({ accountId: 'organization', requesterAccountId: 'person' });
});

test('a service acting as someone never becomes Homiio authority over their files', () => {
  const req = sessionRequest({
    user: { id: 'person' },
    serviceActingAs: { userId: 'person', authority: 'external', scopes: [] },
  });
  expect(sessionActingFor(req)).toBeUndefined();
  expect(sessionFileRequester(req)).toBeUndefined();
  expect(sessionFileRequester(sessionRequest({}))).toBeUndefined();
});

test('owner IDs cannot create user authority for an upload', () => {
  expect(() => personalDocumentFiles(undefined, 'another-account')).toThrow('original requester');
  expect(() =>
    personalDocumentFiles({ kind: 'own', actingFor: { accountId: 'person' } }, 'another-account'),
  ).toThrow('original requester');
  expect(fakeOxyFiles.callsOf('actingFor')).toEqual([]);
  personalDocumentFiles({ kind: 'own', actingFor: { accountId: 'person' } }, 'person');
  expect(fakeOxyFiles.callsOf('actingFor')).toEqual([[{ accountId: 'person' }]]);
});
