/**
 * The CrowdSource client must authenticate through the `@oxy.so/core` this
 * backend actually installs.
 *
 * `@crowdsource.you/core` mints its Oxy service token by loading `@oxy.so/core`
 * at runtime, so nothing at compile time notices when the two drift apart:
 * 1.x looked for the `oxyClient` singleton core 4 no longer exports, still BUILT
 * a client (because `@oxy.so/core/server` resolves), and then every request
 * rejected before leaving the process — every report delivery failed. Real
 * loopback HTTP for both Oxy and CrowdSource; only the responses are fixtures.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import config from '../../config';
import {
  getCrowdSourceClient,
  resetCrowdSourceClient,
} from '../../services/moderation/crowdSourceClient';

const SERVICE_TOKEN = 'fixture_oxy_service_token';
const APPLICATION_ID = 'app_0123456789abcdef0123456789abcdef';
const requests: Array<{ method: string; path: string; authorization?: string }> = [];
let server: http.Server;
let savedBaseUrl: string | undefined;
const savedEnv: Record<string, string | undefined> = {};
const ENV = ['OXY_API_URL', 'OXY_SERVICE_API_KEY', 'OXY_SERVICE_API_SECRET'] as const;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push({
      method: req.method ?? '',
      path: req.url ?? '',
      authorization: req.headers.authorization,
    });
    req.resume();
    res.setHeader('content-type', 'application/json');
    if (req.url === '/auth/service-token') {
      res.end(JSON.stringify({ token: SERVICE_TOKEN, expiresIn: 3600 }));
    } else if (req.url === '/v1/applications/me') {
      res.end(JSON.stringify({ applicationId: APPLICATION_ID }));
    } else if (req.method === 'POST' && req.url === '/v1/reports') {
      res.statusCode = 202;
      res.end(
        JSON.stringify({
          reportId: 'rpt_fixture',
          caseId: 'case_fixture',
          status: 'received',
          merged: false,
        }),
      );
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // `localhost`, not 127.0.0.1: the SDK refuses a plain-http base URL anywhere else.
  const origin = `http://localhost:${(server.address() as AddressInfo).port}`;

  for (const name of ENV) savedEnv[name] = process.env[name];
  process.env.OXY_API_URL = origin;
  process.env.OXY_SERVICE_API_KEY = 'fixture_key';
  process.env.OXY_SERVICE_API_SECRET = 'fixture_secret';
  savedBaseUrl = config.crowdSource.baseUrl;
  config.crowdSource.baseUrl = origin;
  resetCrowdSourceClient();
});

afterAll(async () => {
  resetCrowdSourceClient();
  config.crowdSource.baseUrl = savedBaseUrl;
  for (const name of ENV) {
    if (savedEnv[name] === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = savedEnv[name];
  }
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('CrowdSource client on the installed Oxy SDK', () => {
  it('mints an Oxy service token and presents it when delivering a report', async () => {
    const client = getCrowdSourceClient();
    expect(client).toBeDefined();

    await expect(
      client?.reports.create({
        externalReportId: 'report_fixture_1',
        subject: { externalId: 'property_fixture_1', type: 'commerce.listing' },
        content: 'A listing reported in a test.',
        allegations: ['integrity.spam'],
      }),
    ).resolves.toMatchObject({ reportId: 'rpt_fixture', caseId: 'case_fixture', merged: false });

    expect(requests.some((request) => request.path === '/auth/service-token')).toBe(true);
    const delivery = requests.find(
      (request) => request.method === 'POST' && request.path === '/v1/reports',
    );
    expect(delivery?.authorization).toBe(`Bearer ${SERVICE_TOKEN}`);
  });
});
