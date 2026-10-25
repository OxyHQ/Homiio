import { oxyService } from '../oxy';
/**
 * Homiio's CrowdSource client, which is now one library call.
 *
 * Everything this file used to hold — build the client once, present the
 * credential, decide whether this process can authenticate at all, resolve the
 * tenant and log it — moved into `@crowdsource.you/core`. It had to: Mention and
 * Allo each carried their own copy of the same file, Homiio's being Mention's
 * with the name swapped, and none of those were ever Homiio's decisions to make.
 *
 * ## Homiio holds no CrowdSource key
 *
 * `CROWDSOURCE_SERVICE_KEY` is gone with the wrapper. The client presents the
 * Oxy service token this process already mints — by attesting its ECS task role
 * with a registered environment (Oxy ADR
 * 0049) — and CrowdSource resolves the tenant from the Oxy application that
 * token names. Nothing is issued by hand, stored in a parameter store or rotated
 * by a person, and `applicationId` still appears nowhere: the client asks
 * CrowdSource which tenant the token names, once, and remembers the answer.
 *
 * The delivery loop owns `CROWDSOURCE_ENABLED`; intake always stores its durable
 * outbox row. The injected shared client resolves temporary workload credentials
 * on demand, including local SSO. Authentication failures remain retryable
 * delivery failures; no application key can substitute for the workload.

 */

import {
  crowdSourceForOxyService,
  resetCrowdSourceForOxyService,
  type CrowdSource,
} from '@crowdsource.you/core';
import config from '../../config';
import { logger } from '../../middlewares/logging';

/** The shared workload client. Its request verifies the current identity. */
export function getCrowdSourceClient(): CrowdSource | undefined {
  return crowdSourceForOxyService({
    oxy: oxyService,
    ...(config.crowdSource.baseUrl === undefined ? {} : { baseUrl: config.crowdSource.baseUrl }),
    logger: {
      info: (message, context) => logger.info(message, context),
      error: (message, context) => logger.error(message, context),
    },
  });
}

/** Test hook. Production builds the client once and keeps it for the process. */
export function resetCrowdSourceClient(): void {
  resetCrowdSourceForOxyService();
}
