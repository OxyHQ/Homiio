import { HOMIIO_TEAM_OPERATION_HEADER, privateTeamOperationSchema, teamOperationSchema, type BeginTeamOperation, type PrivateTeamOperation, type TeamOperation } from '@homiio/contracts';
export type { TeamOperation, PrivateTeamOperation, BeginTeamOperation } from '@homiio/contracts';
export type HomiioAuthenticatedTransport = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown>;
export class HomiioTeamClient {
  constructor(private readonly options: { transport?: HomiioAuthenticatedTransport; fetch?: typeof fetch } = {}) {}
  async begin(caseId: string, input: BeginTeamOperation): Promise<PrivateTeamOperation> {
    if (!this.options.transport) throw new Error('An Oxy linked transport is required');
    return privateTeamOperationSchema.parse(await this.options.transport('POST', `/api/v1/cases/${encodeURIComponent(caseId)}/team-chat/operations`, input));
  }
  async finalize(operationId: string): Promise<TeamOperation> {
    if (!this.options.transport) throw new Error('An Oxy linked transport is required');
    return teamOperationSchema.parse(await this.options.transport('POST', '/api/v1/team-chat/finalize', { operationId }));
  }
  async read(operationId: string, capability: string): Promise<TeamOperation> {
    const response = await (this.options.fetch ?? globalThis.fetch)('https://api.homiio.com/api/v1/team-chat/operations/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json', [HOMIIO_TEAM_OPERATION_HEADER]: capability },
      body: JSON.stringify({ operationId }), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Homiio team operation is unavailable');
    return teamOperationSchema.parse(await response.json());
  }
}
