import { createEcosystemTraffic } from '@oxy.so/core/server';

/** Activity has a dedicated credential; inference credentials keep their own scopes. */
export function startPlatformActivity(ready: () => boolean, service = 'homiio') {
  if (process.env.OXY_ECOSYSTEM_ACTIVITY_ENABLED !== 'true') return undefined;
  if (!process.env.OXY_ACTIVITY_API_KEY?.trim() || !process.env.OXY_ACTIVITY_API_SECRET?.trim()) {
    throw new Error('Ecosystem activity requires OXY_ACTIVITY_API_KEY and OXY_ACTIVITY_API_SECRET');
  }
  const traffic = createEcosystemTraffic({ service, ready });
  traffic.installFetch();
  return traffic;
}
