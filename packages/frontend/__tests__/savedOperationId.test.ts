import { createSavedOperationId as createNativeOperationId } from '@/utils/createSavedOperationId';
import { createSavedOperationId } from '@/utils/createSavedOperationId.web';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'native-secure-uuid') }));

it('uses Expo secure UUIDs on native', () => {
  expect(createNativeOperationId()).toBe('native-secure-uuid');
});

const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
afterEach(() => {
  if (previousCrypto) Object.defineProperty(globalThis, 'crypto', previousCrypto);
  else Reflect.deleteProperty(globalThis, 'crypto');
});

it('uses the web crypto UUID generator for queued operation ids', () => {
  const randomUUID = jest.fn().mockReturnValue('a-secure-uuid');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID } });
  expect(createSavedOperationId()).toBe('a-secure-uuid');
  expect(randomUUID).toHaveBeenCalledTimes(1);
});

it('fails closed when secure web UUIDs are unavailable', () => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  expect(createSavedOperationId).toThrow('Secure operation identifiers are unavailable');
});
