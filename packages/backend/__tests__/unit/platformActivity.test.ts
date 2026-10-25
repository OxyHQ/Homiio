const mockInstallFetch = jest.fn();
const mockCreate = jest.fn((_options: unknown) => ({ installFetch: mockInstallFetch }));
const mockCredentials = jest.fn();
jest.mock('@oxy.so/core/server', () => ({
  createEcosystemTraffic: (options: unknown) => mockCreate(options),
}));
jest.mock('../../services/oxy', () => ({ workloadCredentials: mockCredentials }));

import { startPlatformActivity } from '../../services/platformActivity';

const originalRegion = process.env.AWS_REGION;
const originalDefaultRegion = process.env.AWS_DEFAULT_REGION;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.AWS_REGION = 'us-west-2';
  delete process.env.AWS_DEFAULT_REGION;
});
afterEach(() => {
  if (originalRegion === undefined) delete process.env.AWS_REGION;
  else process.env.AWS_REGION = originalRegion;
  if (originalDefaultRegion === undefined) delete process.env.AWS_DEFAULT_REGION;
  else process.env.AWS_DEFAULT_REGION = originalDefaultRegion;
});
it('uses the shared temporary role provider for API activity', () => {
  const ready = () => true;
  expect(startPlatformActivity(ready)).toBeDefined();
  expect(mockCreate).toHaveBeenCalledWith({
    service: 'homiio',
    region: 'us-west-2',
    ready,
    workloadCredentials: mockCredentials,
  });
  expect(mockInstallFetch).toHaveBeenCalledTimes(1);
  expect(mockCredentials).not.toHaveBeenCalled();
});
it('keeps worker identity separate and readiness live', () => {
  const ready = () => false;
  startPlatformActivity(ready, 'homiio-worker');
  expect(mockCreate).toHaveBeenCalledWith({
    service: 'homiio-worker',
    region: 'us-west-2',
    ready,
    workloadCredentials: mockCredentials,
  });
});

it('does not construct a publisher when the host has no infrastructure region', () => {
  delete process.env.AWS_REGION;
  expect(startPlatformActivity(() => true)).toBeUndefined();
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockInstallFetch).not.toHaveBeenCalled();
});
it('uses a configured default region without requiring ECS credentials', () => {
  delete process.env.AWS_REGION;
  process.env.AWS_DEFAULT_REGION = 'eu-west-1';
  startPlatformActivity(() => true);
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ region: 'eu-west-1' }));
  expect(mockCredentials).not.toHaveBeenCalled();
});
