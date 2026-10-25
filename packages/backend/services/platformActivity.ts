import { createEcosystemTraffic } from '@oxy.so/core/server';
import { workloadCredentials } from './oxy';

/** The same temporary AWS role provider works on ECS and authenticated local hosts.
 * Missing or revoked workload authority is reported by the shared publisher.
 */
export function startPlatformActivity(ready: () => boolean, service = 'homiio') {
  // Infrastructure location is required for this optional publisher. Local
  // development and image smoke tests have no location to report.
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) return undefined;
  const traffic = createEcosystemTraffic({ service, region, ready, workloadCredentials });
  traffic.installFetch();
  return traffic;
}
