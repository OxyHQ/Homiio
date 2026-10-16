import { describe, expect, test } from 'bun:test';
import {
  HomiioClient,
  HomiioApiError,
  getHomiioCaseUrl,
  parseHomiioCaseUrl,
  getMentionShareUrl,
} from '../src';

const card = (id: string) => ({
  id,
  title: 'Housing case',
  area: { label: 'Barcelona', precision: 'area' },
  scheduledAt: '2026-10-18T09:00:00.000Z',
  status: 'upcoming',
  url: getHomiioCaseUrl(id),
});
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
describe('current public case references', () => {
  test('deduplicates and chunks visible refs, passes abort and forbids caching', async () => {
    const calls: RequestInit[] = [];
    const signal = new AbortController().signal;
    const client = new HomiioClient({
      fetch: (async (_url, init) => {
        if (!init) throw new Error('Missing batch request');
        calls.push(init);
        const { ids } = JSON.parse(init.body as string);
        return reply({ items: ids.map(card), unavailableIds: [] });
      }) as typeof fetch,
    });
    const ids = Array.from({ length: 55 }, (_, i) => `case-${i}`);
    const result = await client.getPublicCases([...ids, ids[0]], { signal });
    expect(result.items).toHaveLength(55);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.signal === signal && call.cache === 'no-store')).toBe(true);
  });
  test('rejects private fields and mismatched response IDs', async () => {
    for (const body of [
      { items: [{ ...card('a'), exactAddress: 'private' }], unavailableIds: [] },
      { items: [card('b')], unavailableIds: [] },
      { items: [card('a')], unavailableIds: ['a'] },
      { items: [], unavailableIds: [] },
    ]) {
      const client = new HomiioClient({ fetch: (async () => reply(body)) as typeof fetch });
      await expect(client.getPublicCases(['a'])).rejects.toThrow();
    }
  });
  test('withdrawal and failure never return a previously resolved copy', async () => {
    let count = 0;
    const client = new HomiioClient({
      fetch: (async () => {
        count++;
        if (count === 1) return reply({ items: [card('a')], unavailableIds: [] });
        if (count === 2) return reply({ items: [], unavailableIds: ['a'] });
        return reply({ error: { code: 'service_unavailable', message: 'Try again.' } }, 503);
      }) as typeof fetch,
    });
    expect((await client.getPublicCases(['a'])).items).toHaveLength(1);
    expect(await client.getPublicCases(['a'])).toEqual({ items: [], unavailableIds: ['a'] });
    await expect(client.getPublicCases(['a'])).rejects.toBeInstanceOf(HomiioApiError);
  });
  test('only accepts canonical case links and shares an opaque ID', () => {
    const id = 'opaque case + value';
    expect(parseHomiioCaseUrl(getHomiioCaseUrl(id))).toBe(id);
    expect(getMentionShareUrl(id)).toBe(
      'https://mention.earth/compose?homiioCaseId=opaque%20case%20%2B%20value',
    );
    for (const url of [
      'https://evil.test/evictions/a',
      'https://homiio.com.evil.test/evictions/a',
      'https://homiio.com/properties/a',
      'https://user@homiio.com/evictions/a',
    ]) {
      expect(parseHomiioCaseUrl(url)).toBeNull();
    }
  });
});

describe('client entry', () => {
  test('resolves cards without loading the schema runtime', () => {
    const probe = Bun.spawnSync(
      [
        process.execPath,
        '-e',
        "require('./dist/client.js'); console.log(Object.keys(require.cache).some((k) => k.includes('/zod/')))",
      ],
      { cwd: `${import.meta.dir}/..` },
    );
    expect(probe.stdout.toString().trim()).toBe('false');
  });
  test('rejects error bodies outside the contract', async () => {
    for (const body of [
      { error: { code: 'teapot', message: 'no' } },
      { error: { code: 'not_found', message: 'gone', details: { nested: { a: 1 } } } },
      { error: { code: 'not_found', message: 'gone', extra: true } },
    ]) {
      const client = new HomiioClient({ fetch: (async () => reply(body, 404)) as typeof fetch });
      await expect(client.getPublicCases(['a'])).rejects.toBeInstanceOf(TypeError);
    }
  });
});
