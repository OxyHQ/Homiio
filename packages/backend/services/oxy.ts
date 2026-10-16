import { OxyServer } from '@oxy.so/core/server';
import config from '../config';

/**
 * The outbound, service-authenticated Oxy SDK instance owned by Homiio.
 *
 * This is deliberately separate from the session verifier in `server.ts`:
 * configuring service auth must not change the credential lane used to verify
 * incoming user sessions. A provider credential never reaches this process;
 * Kaana owns those in its encrypted database.
 *
 * The credential pair is now OPTIONAL, and a deployment no longer carries one.
 *
 * Under oxy ADR 0026 a first-party service proves what it IS: `serviceToken()`
 * attests the ECS task role and gets the same short-lived token back whenever no
 * credential is configured. Installing a pair is therefore the fallback rather
 * than the requirement — a checkout that still has `OXY_SERVICE_API_KEY` and
 * `OXY_SERVICE_API_SECRET` keeps using them, and dropping the two variables IS
 * the migration.
 *
 * Both or neither. One alone authenticates nothing, and configuring half a pair
 * would REPLACE the attestation path with a credential that cannot mint.
 */
export const oxyService = new OxyServer({
  baseURL: config.oxy.baseURL,
  ...(config.oxy.serviceApiKey && config.oxy.serviceApiSecret
    ? { serviceAuth: { apiKey: config.oxy.serviceApiKey, apiSecret: config.oxy.serviceApiSecret } }
    : {}),
});
