import { canAttestWorkloadIdentity, createEcosystemTraffic } from '@oxy.so/core/server';

/**
 * Publishes Homiio's ecosystem activity as the process's own Oxy identity.
 *
 * On ECS that is the task role (oxy ADR 0026): `oxy-homiio-task` and
 * `oxy-homiio-worker-task` are bound to the Homiio application, and the
 * publisher attests whichever this process runs as. Off ECS, a full
 * `OXY_ACTIVITY_API_KEY`/`_SECRET` pair still works and wins; half a pair is no
 * identity, so nothing starts.
 */
export function startPlatformActivity(
  ready: () => boolean,
  service = 'homiio',
  canAttest: () => boolean = canAttestWorkloadIdentity,
) {
  const key = process.env.OXY_ACTIVITY_API_KEY?.trim();
  const secret = process.env.OXY_ACTIVITY_API_SECRET?.trim();
  if (!(key && secret) && (key || secret || !canAttest())) {
    return undefined;
  }
  const traffic = createEcosystemTraffic({ service, ready });
  traffic.installFetch();
  return traffic;
}
