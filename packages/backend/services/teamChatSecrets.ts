import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  createHash,
  timingSafeEqual,
} from 'node:crypto';
function key(): Buffer {
  const value = process.env.HOMIIO_TEAM_CHAT_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new Error('Team chat is not configured');
  return Buffer.from(value, 'hex');
}
export const referenceHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const operationCapability = (id: string) =>
  createHmac('sha256', key()).update(`operation:${id}`).digest('base64url');
export function verifyOperationCapability(id: string, capability: string): boolean {
  const expected = Buffer.from(operationCapability(id));
  const received = Buffer.from(capability);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
export function sealTeamReference(caseId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(caseId));
  const encrypted = Buffer.concat([
    cipher.update(randomBytes(32).toString('base64url'), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function openTeamReference(caseId: string, ciphertext: string): string {
  const bytes = Buffer.from(ciphertext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  decipher.setAAD(Buffer.from(caseId));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}
