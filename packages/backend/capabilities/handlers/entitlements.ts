import { consumeFileCredit, readFileEntitlement } from '../../domain/entitlements';
import type { HomiioToolHandlers } from './context';

export const ENTITLEMENT_HANDLERS: HomiioToolHandlers = {
  readFileEntitlement: async (_input, { accountId }) => ({
    ...(await readFileEntitlement(accountId)),
  }),
  consumeFileCredit: async (_input, { accountId }) => ({ ...(await consumeFileCredit(accountId)) }),
};
