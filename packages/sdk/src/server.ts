import { HomiioTeamClient } from './team.js';

export const SERVICE_AUDIENCE = 'oxy-service:6a2f851751b784a86fd0e922';

/** Own transport identity does not replace the team's resource capability. */
export interface HomiioServiceHost {
  createServiceClient(options: { baseURL: string; audience: string }): { fetch: typeof fetch };
}

export function homiioTeamForOxyService(oxy: HomiioServiceHost): HomiioTeamClient {
  const client = oxy.createServiceClient({
    baseURL: 'https://api.homiio.com',
    audience: SERVICE_AUDIENCE,
  });
  return new HomiioTeamClient({ fetch: client.fetch });
}
