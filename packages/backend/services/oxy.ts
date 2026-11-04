import { createAwsWorkloadCredentialProvider } from '@oxy.so/core/server/aws';
import { OxyServer } from '@oxy.so/core/server';
import config from '../config';

/** Homiio's Oxy application: the owner of its application roles and its service audience. */
export const HOMIIO_APPLICATION_ID = '6a2f851751b784a86fd0e922';

/**
 * The one Oxy client of this process. Own outbound calls use the registered
 * workload and environment (Oxy ADR 0049); customer application credentials
 * never substitute for Homiio's identity. Session-less reads (`users.lookupMany`)
 * carry the workload token, and every `auth()` / `service()` mount accepts
 * service tokens minted for Homiio's own audience.
 */
export const workloadCredentials = createAwsWorkloadCredentialProvider();
export const oxyService = new OxyServer({
  baseURL: config.oxy.baseURL,
  applicationId: HOMIIO_APPLICATION_ID,
  serviceIdentity: 'when-anonymous',
  expectedAudience: `oxy-service:${HOMIIO_APPLICATION_ID}`,
  workloadCredentials,
});

/** Shared transport handles minting, cancellation, audience and credential renewal. */
export const oxyServiceTransport = oxyService.createServiceClient({
  baseURL: config.oxy.baseURL,
  audience: 'oxy-api',
});
