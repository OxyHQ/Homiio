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
 * in a deployment, or from a credential pair in a checkout that has one (oxy ADR
 * 0026) — and CrowdSource resolves the tenant from the Oxy application that
 * token names. Nothing is issued by hand, stored in a parameter store or rotated
 * by a person, and `applicationId` still appears nowhere: the client asks
 * CrowdSource which tenant the token names, once, and remembers the answer.
 *
 * ## `CROWDSOURCE_ENABLED` is not here either
 *
 * The flag gates the delivery LOOP, in `ModerationOutboxDispatcher` and
 * `services/cron.ts`, which is the place that acts on it. Repeating it here
 * would be a second answer to one question — and the wrong one for the state it
 * describes, because `undefined` from this factory means "this process cannot
 * authenticate", which is what a local checkout genuinely is. A report filed
 * against either state must still be STORED; the durable outbox row is never
 * gated, and the delivery worker is what notices there is nowhere to send it.
 */

import {
  crowdSourceForOxyService,
  resetCrowdSourceForOxyService,
  type CrowdSource,
} from '@crowdsource.you/core';
import config from '../../config';
import { logger } from '../../middlewares/logging';

/** The client, or `undefined` where this deployment cannot authenticate. */
export function getCrowdSourceClient(): CrowdSource | undefined {
  return crowdSourceForOxyService({
    ...(config.crowdSource.baseUrl === undefined
      ? {}
      : { baseUrl: config.crowdSource.baseUrl }),
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
