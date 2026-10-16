import { describe, expect, test } from 'bun:test';
import {
  caseIdSchema,
  getHomiioCaseUrl,
  getMentionShareUrl,
  parseHomiioCaseUrl,
} from '@oxy.so/homiio-contracts';
import * as links from '@oxy.so/homiio-contracts/links';

describe('lightweight public links', () => {
  test('leaf and barrel keep shared case ID validation and escaping', () => {
    for (const id of ['a', 'a/b ?#é', 'x'.repeat(200), '😀'.repeat(100)]) {
      expect(caseIdSchema.safeParse(id).success).toBe(true);
      expect(links.getHomiioCaseUrl(id)).toBe(getHomiioCaseUrl(id));
      expect(links.getMentionShareUrl(id)).toBe(getMentionShareUrl(id));
      expect(links.parseHomiioCaseUrl(links.getHomiioCaseUrl(id))).toBe(id);
    }
    for (const id of ['', 'x'.repeat(201)]) {
      expect(caseIdSchema.safeParse(id).success).toBe(false);
      expect(() => links.getHomiioCaseUrl(id)).toThrow();
      expect(() => getHomiioCaseUrl(id)).toThrow();
      expect(() => links.getMentionShareUrl(id)).toThrow();
      expect(() => getMentionShareUrl(id)).toThrow();
    }
  });
  test('rejects non-public origins, credentials, malformed escapes and invalid identifiers', () => {
    for (const value of [
      'https://evil.example/evictions/a',
      'http://homiio.com/evictions/a',
      'https://user@homiio.com/evictions/a',
      'https://homiio.com/evictions/',
      'https://homiio.com/evictions/a/b',
      'https://homiio.com/evictions/%XX',
      `https://homiio.com/evictions/${'x'.repeat(201)}`,
    ]) {
      expect(links.parseHomiioCaseUrl(value)).toBeNull();
      expect(parseHomiioCaseUrl(value)).toBeNull();
    }
  });
});
