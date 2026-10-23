import { createEcosystemTraffic } from '@oxy.so/core/server';
import { workloadCredentials } from './oxy';

/** The same temporary AWS role provider works on ECS and authenticated local hosts.
 * Missing or revoked workload authority is reported by the shared publisher.
 */
export function startPlatformActivity(ready: () => boolean, service = 'homiio') {
  const traffic = createEcosystemTraffic({ service, ready, workloadCredentials });
  traffic.installFetch();
  return traffic;
}
