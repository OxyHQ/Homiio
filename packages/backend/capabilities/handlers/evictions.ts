/**
 * Eviction board tools → `domain/evictions/*`, as the effective account.
 *
 * The public reads pass the effective account as the VIEWER, exactly as the
 * public route passes an optional session, so disclosure (contact unlock,
 * viewer flags, published precision) is decided per person by the same
 * `toEvictionDTO`. The case id is the target named in the input; whether the
 * account may act on it is the domain's query. Each answers the route's body
 * minus `success`, `message` and `meta`.
 */

import {
  addEvictionCollaborator,
  clearEvictionHold,
  commentOnEvictionCase,
  deleteEvictionCase,
  deleteEvictionCaseComment,
  getEvictionCase,
  getEvictionLocationAudit,
  getEvictionTeam,
  getExactEvictionLocation,
  grantEvictionLocation,
  listAttendingEvictionCases,
  listEvictionBoard,
  listEvictionCaseComments,
  listEvictionLocationGrants,
  listEvictionResources,
  listFollowedEvictionCases,
  listMyEvictionCases,
  postEvictionUpdate,
  removeEvictionCollaborator,
  reportEvictionCase,
  reportEvictionContent,
  revokeEvictionLocationGrant,
  revokeEvictionSupporter,
  toggleEvictionAttendance,
  toggleEvictionFollow,
  updateEvictionCase,
  vouchForEvictionSupporter,
} from '../../domain/evictions';
import { type HomiioToolHandlers, type ToolInput, requiredString } from './context';

const caseIdOf = (input: ToolInput) => requiredString(input, 'caseId');

/** The tool input minus `caseId`: the body the route would have received. */
function bodyOf(input: ToolInput): Record<string, unknown> {
  const { caseId: _caseId, ...body } = input;
  return body;
}

export const EVICTION_HANDLERS: HomiioToolHandlers = {
  async listEvictionCases(input, { accountId }) {
    return { data: await listEvictionBoard(accountId, input) };
  },
  async getEvictionCase(input, { accountId }) {
    return { data: await getEvictionCase(accountId, caseIdOf(input)) };
  },
  async listEvictionComments(input) {
    return { data: await listEvictionCaseComments(caseIdOf(input), bodyOf(input)) };
  },
  async listEvictionResources(input) {
    return {
      data: await listEvictionResources({
        countryCode: input.countryCode,
        regionId: input.regionId,
      }),
    };
  },
  async listMyEvictionCases(input, { accountId }) {
    return { data: await listMyEvictionCases(accountId, input) };
  },
  async listAttendingEvictionCases(input, { accountId }) {
    return { data: await listAttendingEvictionCases(accountId, input) };
  },
  async listFollowedEvictionCases(input, { accountId }) {
    return { data: await listFollowedEvictionCases(accountId, input) };
  },
  async getEvictionTeam(input, { accountId }) {
    return { data: await getEvictionTeam(accountId, caseIdOf(input)) };
  },

  async reportEvictionCase(input, { accountId }) {
    return { data: await reportEvictionCase(accountId, input) };
  },
  async updateEvictionCase(input, { accountId }) {
    return { data: await updateEvictionCase(accountId, caseIdOf(input), bodyOf(input)) };
  },
  async deleteEvictionCase(input, { accountId }) {
    await deleteEvictionCase(accountId, caseIdOf(input));
    return { data: null };
  },
  async postEvictionUpdate(input, { accountId }) {
    return { data: await postEvictionUpdate(accountId, caseIdOf(input), bodyOf(input)) };
  },
  async clearEvictionHold(input, { accountId }) {
    return { data: await clearEvictionHold(accountId, caseIdOf(input), input.message) };
  },

  async toggleEvictionAttendance(input, { accountId }) {
    return { data: await toggleEvictionAttendance(accountId, caseIdOf(input)) };
  },
  async toggleEvictionFollow(input, { accountId }) {
    return { data: await toggleEvictionFollow(accountId, caseIdOf(input)) };
  },
  async vouchForSupporter(input, { accountId }) {
    return {
      data: await vouchForEvictionSupporter(
        accountId,
        caseIdOf(input),
        requiredString(input, 'oxyUserId'),
      ),
    };
  },
  async revokeSupporter(input, { accountId }) {
    return {
      data: await revokeEvictionSupporter(
        accountId,
        caseIdOf(input),
        requiredString(input, 'oxyUserId'),
      ),
    };
  },
  async addEvictionCollaborator(input, { accountId }) {
    return {
      data: await addEvictionCollaborator(accountId, caseIdOf(input), {
        oxyUserId: input.oxyUserId,
        acknowledgeExactLocationAccess: input.acknowledgeExactLocationAccess,
      }),
    };
  },
  async removeEvictionCollaborator(input, { accountId }) {
    return { data: await removeEvictionCollaborator(accountId, caseIdOf(input), input.oxyUserId) };
  },

  async getExactEvictionLocation(input, { accountId }) {
    return { data: await getExactEvictionLocation(accountId, caseIdOf(input)) };
  },
  async listEvictionLocationGrants(input, { accountId }) {
    return { data: await listEvictionLocationGrants(accountId, caseIdOf(input)) };
  },
  async getEvictionLocationAudit(input, { accountId }) {
    return { data: await getEvictionLocationAudit(accountId, caseIdOf(input)) };
  },
  async grantEvictionLocation(input, { accountId }) {
    return {
      data: await grantEvictionLocation(accountId, caseIdOf(input), {
        granteeOxyUserId: input.granteeOxyUserId,
        purpose: input.purpose,
        hours: input.hours,
      }),
    };
  },
  async revokeEvictionLocationGrant(input, { accountId }) {
    return {
      data: await revokeEvictionLocationGrant(
        accountId,
        caseIdOf(input),
        requiredString(input, 'granteeOxyUserId'),
      ),
    };
  },

  async commentOnEviction(input, { accountId }) {
    return { data: await commentOnEvictionCase(accountId, caseIdOf(input), bodyOf(input)) };
  },
  async deleteEvictionComment(input, { accountId }) {
    await deleteEvictionCaseComment(accountId, caseIdOf(input), requiredString(input, 'commentId'));
    return { data: null };
  },
  async reportEvictionContent(input, { accountId }) {
    const outcome = await reportEvictionContent(accountId, caseIdOf(input), bodyOf(input));
    return { data: outcome.report };
  },
};
