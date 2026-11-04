import {
  privateTeamOperationSchema,
  teamOperationSchema,
  type BeginTeamOperation,
  type PrivateTeamOperation,
  type TeamOperation,
} from '@oxy.so/homiio-contracts';
export type {
  TeamOperation,
  PrivateTeamOperation,
  BeginTeamOperation,
} from '@oxy.so/homiio-contracts';
export type HomiioAuthenticatedTransport = (
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
) => Promise<unknown>;
/**
 * The case owner's side of a team operation, over the signed-in person's Oxy
 * linked transport. Reading an operation is a service call:
 * `homiioTeamForOxyService(oxy).read` in `@oxy.so/homiio-sdk/server`.
 */
export class HomiioTeamClient {
  constructor(private readonly options: { transport: HomiioAuthenticatedTransport }) {}
  async begin(caseId: string, input: BeginTeamOperation): Promise<PrivateTeamOperation> {
    return privateTeamOperationSchema.parse(
      await this.options.transport(
        'POST',
        `/api/evictions/${encodeURIComponent(caseId)}/team-chat/operations`,
        input,
      ),
    );
  }
  async finalize(operationId: string): Promise<TeamOperation> {
    return teamOperationSchema.parse(
      await this.options.transport('POST', '/api/team-chat/finalize', { operationId }),
    );
  }
}
