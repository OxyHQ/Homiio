/**
 * Homiio publishes activity as whatever Oxy identity the process has: a full
 * activity key pair where one is set, otherwise the task role it can attest.
 * Half a pair is no identity, attestable or not.
 */

const mockInstallFetch = jest.fn();
const mockCreate = jest.fn((_options: unknown) => ({ installFetch: mockInstallFetch }));
jest.mock('@oxy.so/core/server', () => ({
  createEcosystemTraffic: (options: unknown) => mockCreate(options),
  canAttestWorkloadIdentity: () => false,
}));

import { startPlatformActivity } from '../../services/platformActivity';

const keys = ['OXY_ACTIVITY_API_KEY', 'OXY_ACTIVITY_API_SECRET'] as const;
let original: Array<string | undefined>;

beforeEach(() => {
  original = keys.map((key) => process.env[key]);
  for (const key of keys) delete process.env[key];
  jest.clearAllMocks();
});
afterEach(() => {
  keys.forEach((key, index) => {
    if (original[index] === undefined) delete process.env[key];
    else process.env[key] = original[index];
  });
});

it('starts with a full activity key pair', () => {
  process.env.OXY_ACTIVITY_API_KEY = 'key';
  process.env.OXY_ACTIVITY_API_SECRET = 'secret';
  expect(
    startPlatformActivity(
      () => true,
      'homiio',
      () => false,
    ),
  ).toBeDefined();
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ service: 'homiio' }));
  expect(mockInstallFetch).toHaveBeenCalledTimes(1);
});

it('starts on the attested task role when no pair is set', () => {
  expect(
    startPlatformActivity(
      () => true,
      'homiio-worker',
      () => true,
    ),
  ).toBeDefined();
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ service: 'homiio-worker' }));
});

it('does not start with neither a pair nor an attestable role', () => {
  expect(
    startPlatformActivity(
      () => true,
      'homiio',
      () => false,
    ),
  ).toBeUndefined();
  expect(mockCreate).not.toHaveBeenCalled();
});

it('never treats half a pair as an identity, even where it could attest', () => {
  process.env.OXY_ACTIVITY_API_KEY = 'key-only';
  expect(
    startPlatformActivity(
      () => true,
      'homiio',
      () => true,
    ),
  ).toBeUndefined();
  expect(mockCreate).not.toHaveBeenCalled();
});
