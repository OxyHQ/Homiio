import { OxyServices } from '@oxyhq/core';
import config from '../config';
import { logger } from '../middlewares/logging';

let serviceClient: OxyServices | null = null;

function getServiceClient(): OxyServices | null {
  if (!serviceClient) {
    serviceClient = new OxyServices({ baseURL: config.oxy.baseURL });

    const apiKey = process.env.OXY_SERVICE_API_KEY;
    const apiSecret = process.env.OXY_SERVICE_API_SECRET;
    if (apiKey && apiSecret) {
      serviceClient.configureServiceAuth(apiKey, apiSecret);
    } else {
      const token = process.env.OXY_SERVICE_TOKEN;
      if (token) {
        serviceClient.setTokens(token);
      } else {
        return null;
      }
    }
  }
  return serviceClient;
}

/**
 * Best-effort Oxy Trust award on lease lifecycle events.
 * Requires upstream Homiio ReputationRules + service credential with reputation:write.
 */
export async function awardLeaseReputation(
  oxyUserId: string,
  actionType: 'lease_signed' | 'lease_completed' | 'clean_moveout' | 'lease_default',
  sourceActionId: string,
): Promise<void> {
  const client = getServiceClient();
  if (!client?.awardReputation) return;

  try {
    await client.awardReputation({
      userId: oxyUserId,
      actionType,
      sourceActionId,
    });
  } catch (error: unknown) {
    logger.warn('awardLeaseReputation failed (best-effort)', {
      oxyUserId,
      actionType,
      sourceActionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
