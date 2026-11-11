import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

describe('fetchWithTimeout', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('aborts a request that never answers', async () => {
    global.fetch = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    ) as unknown as typeof fetch;
    await expect(fetchWithTimeout('https://x.test', {}, 20)).rejects.toThrow(/timed out/);
  });

  it('passes a prompt response through', async () => {
    global.fetch = jest.fn(async () => new Response('ok')) as unknown as typeof fetch;
    const response = await fetchWithTimeout('https://x.test');
    expect(await response.text()).toBe('ok');
  });
});
