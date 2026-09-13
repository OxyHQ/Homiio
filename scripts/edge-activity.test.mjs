import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker0 from '../packages/frontend/worker/index.js';

test('frontend keeps asset streams, headers and errors when telemetry is disabled', async () => {
  const response = new Response('asset bytes', { headers: { 'content-type': 'application/javascript', 'cache-control': 'public, max-age=3600' } });
  const request = new Request('https://example.test/assets/app.js');
  const env = { ASSETS: { fetch: async () => response } };
  const ctx = { waitUntil() { throw new Error('disabled telemetry scheduled work'); } };
  assert.equal(await worker0.fetch(request, env, ctx), response);
  assert.equal(await response.text(), 'asset bytes');
  const failure = new Error('asset binding failure');
  env.ASSETS.fetch = async () => { throw failure; };
  await assert.rejects(worker0.fetch(request, env, ctx), error => error === failure);
});


test('enabled edge producer publishes actual media operations without a dashboard viewer', async () => {
  const originalFetch = globalThis.fetch;
  const originalCompare = crypto.subtle.timingSafeEqual;
  const publications = [];
  const pending = [];
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === '/auth/service-token') return Response.json({ token: 'test-token', expiresIn: 3600 });
    publications.push(JSON.parse(init.body));
    return Response.json({ ok: true });
  };
  try {
    const env = { OXY_EDGE_ACTIVITY_ENABLED: 'true', OXY_EDGE_ACTIVITY_API_KEY: 'key', OXY_EDGE_ACTIVITY_API_SECRET: 'secret', ASSETS: { fetch: async () => new Response('image', { headers: { 'content-type': 'image/png' } }) } };
    const request = new Request('https://example.test/private-image.png');
    Object.defineProperty(request, 'cf', { value: { colo: 'MAD' } });
    
    
    const response = await worker0.fetch(request, env, { waitUntil(promise) { pending.push(promise); } });
    assert.equal(await response.text(), 'image');
    await Promise.all(pending);
    const events = publications.flat();
    assert.equal(events.length, 2);
    assert.deepEqual(events.map(event => [event.service, event.region, event.scope, event.direction, event.activityType]), [
      ['homiio', 'edge-mad', 'external', 'inbound', 'media'],
      ['homiio', 'edge-mad', 'external', 'outbound', 'media'],
    ]);
    assert.equal(events[0].sourceRegion, undefined);
    assert.doesNotMatch(JSON.stringify(events), /private-image|secret/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCompare === undefined) delete crypto.subtle.timingSafeEqual;
    else crypto.subtle.timingSafeEqual = originalCompare;
  }
});
