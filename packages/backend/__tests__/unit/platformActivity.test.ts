const mockInstallFetch = jest.fn();
const mockCreate = jest.fn((_options: unknown) => ({ installFetch: mockInstallFetch }));
const mockCredentials = jest.fn();
jest.mock('@oxy.so/core/server', () => ({
  createEcosystemTraffic: (options: unknown) => mockCreate(options),
}));
jest.mock('../../services/oxy', () => ({ workloadCredentials: mockCredentials }));

import { startPlatformActivity } from '../../services/platformActivity';

beforeEach(() => jest.clearAllMocks());
it('uses the shared temporary role provider for API activity', () => {
  const ready = () => true;
  expect(startPlatformActivity(ready)).toBeDefined();
  expect(mockCreate).toHaveBeenCalledWith({
    service: 'homiio',
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
    ready,
    workloadCredentials: mockCredentials,
  });
});
