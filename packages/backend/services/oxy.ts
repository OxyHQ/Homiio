import { OxyServices } from '@oxyhq/core';
import config from '../config';

/**
 * The outbound, service-authenticated Oxy SDK instance owned by Homiio.
 *
 * This is deliberately separate from the session verifier in `server.ts`:
 * configuring service auth must not change the credential lane used to verify
 * incoming user sessions. A provider credential never reaches this process;
 * Kaana owns those in its encrypted database.
 */
export const oxyService = new OxyServices({ baseURL: config.oxy.baseURL });

if (config.oxy.serviceApiKey && config.oxy.serviceApiSecret) {
  oxyService.configureServiceAuth(config.oxy.serviceApiKey, config.oxy.serviceApiSecret);
}
