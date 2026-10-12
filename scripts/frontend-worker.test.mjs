import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker0 from '../packages/frontend/worker/index.js';

test('frontend Worker returns the asset response unchanged and propagates asset errors', async () => {
  const response = new Response('asset bytes', {
    headers: { 'content-type': 'application/javascript', 'cache-control': 'public, max-age=3600' },
  });
  const request = new Request('https://example.test/assets/app.js');
  const env = { ASSETS: { fetch: async () => response } };
  const ctx = {
    waitUntil() {
      throw new Error('the Worker scheduled background work');
    },
  };
  assert.equal(await worker0.fetch(request, env, ctx), response);
  assert.equal(await response.text(), 'asset bytes');
  const failure = new Error('asset binding failure');
  env.ASSETS.fetch = async () => {
    throw failure;
  };
  await assert.rejects(worker0.fetch(request, env, ctx), (error) => error === failure);
});
