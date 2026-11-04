import {
  HOMIIO_TEAM_OPERATION_HEADER,
  teamOperationSchema,
  type TeamOperation,
} from '@oxy.so/homiio-contracts';

const HOMIIO_API_ORIGIN = 'https://api.homiio.com';

/** Homiio's Oxy application, addressed as the receiver of the service token. */
export const SERVICE_AUDIENCE = 'oxy-service:6a2f851751b784a86fd0e922';

/** The one `OxyServer` method this entry uses, so it carries no Oxy types. */
export interface HomiioServiceHost {
  createServiceClient(options: { baseURL: string; audience: string }): { fetch: typeof fetch };
}

/** Resource-scoped read of one immutable team operation. Confers no write access. */
export interface HomiioTeamOperationReader {
  read(operationId: string, capability: string): Promise<TeamOperation>;
}

/**
 * The only way to read a team operation: every request carries this process's
 * Oxy service token (transport identity) AND the operation's capability
 * (resource grant). Neither replaces the other. The transport is pinned to
 * Homiio's origin, refuses redirects and never caches.
 */
export function homiioTeamForOxyService(oxy: HomiioServiceHost): HomiioTeamOperationReader {
  const { fetch } = oxy.createServiceClient({
    baseURL: HOMIIO_API_ORIGIN,
    audience: SERVICE_AUDIENCE,
  });
  return {
    async read(operationId, capability) {
      const response = await fetch(`${HOMIIO_API_ORIGIN}/api/v1/team-chat/operations/read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [HOMIIO_TEAM_OPERATION_HEADER]: capability,
        },
        body: JSON.stringify({ operationId }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('Homiio team operation is unavailable');
      return teamOperationSchema.parse(await response.json());
    },
  };
}
