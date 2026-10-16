import {
  AddressRequestError,
  createAddress,
  findNearbyAddresses,
  getAddress,
  listAddressCorrections,
  proposeAddressCorrection,
  searchAddresses,
  updateAddress,
  withdrawAddressCorrection,
} from '../../domain/addresses';
import { AppError } from '../../middlewares/errorHandler';
import { type HomiioToolHandlers, type ToolInput, requiredObject, requiredString } from './context';

/** A refusal that lists its reasons carries them in the tool error's message. */
async function withReasons<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AddressRequestError && error.errors?.length) {
      throw new AppError(
        `${error.message}: ${error.errors.join('; ')}`,
        error.statusCode,
        error.code ?? 'VALIDATION_ERROR',
      );
    }
    throw error;
  }
}

/** The body fields of the route: everything but the path parameters. */
function bodyOf(input: ToolInput, ...pathKeys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !pathKeys.includes(key)));
}

export const ADDRESS_HANDLERS: HomiioToolHandlers = {
  searchAddresses: async (input) => searchAddresses(input),
  findNearbyAddresses: async (input) => findNearbyAddresses(input),
  getAddress: async (input, { accountId }) =>
    getAddress(accountId, requiredString(input, 'addressId')),
  createAddress: async (input) =>
    withReasons(() => createAddress(requiredObject(input, 'address'))),
  updateAddress: async (input, { accountId }) =>
    withReasons(() =>
      updateAddress(accountId, requiredString(input, 'addressId'), bodyOf(input, 'addressId')),
    ),
  listAddressCorrections: async (input, { accountId }) =>
    listAddressCorrections(accountId, requiredString(input, 'addressId')),
  proposeAddressCorrection: async (input, { accountId }) =>
    withReasons(() =>
      proposeAddressCorrection(
        accountId,
        requiredString(input, 'addressId'),
        bodyOf(input, 'addressId'),
      ),
    ),
  withdrawAddressCorrection: async (input, { accountId }) =>
    withdrawAddressCorrection(
      accountId,
      requiredString(input, 'addressId'),
      requiredString(input, 'proposalId'),
    ),
};
