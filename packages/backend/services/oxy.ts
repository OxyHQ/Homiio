import { createAwsWorkloadCredentialProvider } from '@oxy.so/core/server/aws';
import { OxyServer } from '@oxy.so/core/server';
import config from '../config';

/** Own outbound calls use the registered workload and environment (Oxy ADR 0049).
 * Customer application credentials never substitute for Homiio's identity.
 */
export const HOMIIO_SERVICE_AUDIENCE = 'oxy-service:6a2f851751b784a86fd0e922';

export const workloadCredentials = createAwsWorkloadCredentialProvider();
export const oxyService = new OxyServer({
  baseURL: config.oxy.baseURL,
  workloadCredentials,
});

/** Shared transport handles minting, cancellation, audience and credential renewal. */
export const oxyServiceTransport = oxyService.createServiceClient({
  baseURL: config.oxy.baseURL,
  audience: 'oxy-api',
});
