import { personalDocumentFiles } from '../../services/files/requester';
import { redactRequesterProofs } from '../../middlewares/logging';

test('redacts incoming and nested requester proofs while keeping operation metadata', () => {
  const result = redactRequesterProofs({
    req: {
      headers: {
        authorization: 'Bearer secret',
        'x-oxy-requester-token': 'requester',
        'x-oxy-capability-ticket': 'ticket',
        'x-oxy-requester-context': 'context',
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

test('owner IDs cannot create user authority for an upload', () => {
  expect(() => personalDocumentFiles(undefined, 'another-account')).toThrow('original requester');
});
