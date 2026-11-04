/**
 * `/api/scraper/*`: who may operate it, and what it may reach.
 *
 * WHO is an Oxy application permission (`homiio.scraper.operate`), read fresh
 * on every call through the SDK's `requireAppPermission`. Oxy's roles read is
 * stubbed at the SDK's own seam (`fetchRolesMe`), so the resolver, its outcome
 * mapping and its cache are the production ones: a non-holder gets 404, an Oxy
 * outage gets 503 — and is never remembered as "no".
 *
 * WHAT is the allowlist plus `safeFetch`: a server the endpoint names on an
 * internal address is never reached, and the scrape reports the failure rather
 * than "found nothing".
 */

import http from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { OxyApiError } from '@oxy.so/core';

import scraperRoutes from '../../routes/scraper';
import { SCRAPER_OPERATE_PERMISSION } from '../../services/applicationPermissions';
import { HOMIIO_APPLICATION_ID, oxyService } from '../../services/oxy';
import { runExternalScrape } from '../../services/scraperService';

const OPERATOR = 'oxy-scraper-operator';

type RolesMe = (applicationId: string, accessToken: string) => Promise<unknown>;
const oxyInternals = oxyService as unknown as { fetchRolesMe: RolesMe };

/** A request `middleware.auth()` verified: a person in a session. */
function asSession(userId: string | null) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (userId) {
      Object.assign(req, {
        userId,
        sessionId: `session-${userId}`,
        accessToken: `token-${userId}`,
        user: { id: userId },
      });
    }
    next();
  };
}

function appFor(userId: string | null) {
  const app = express();
  app.use(express.json());
  app.use(asSession(userId));
  app.use('/api/scraper', scraperRoutes());
  return app;
}

function rolesMe(permissions: string[]) {
  return async (applicationId: string) => ({ applicationId, userId: OPERATOR, permissions });
}

afterEach(() => {
  jest.restoreAllMocks();
  oxyService.invalidateAppPermissions();
});

describe('the operator gate', () => {
  it('admits a person holding homiio.scraper.operate on Homiio’s application', async () => {
    const roles = jest
      .spyOn(oxyInternals, 'fetchRolesMe')
      .mockImplementation(rolesMe([SCRAPER_OPERATE_PERMISSION]));
    const res = await request(appFor(OPERATOR)).get('/api/scraper/sources').expect(200);
    expect(res.body.data).toEqual([]);
    expect(roles).toHaveBeenCalledWith(HOMIIO_APPLICATION_ID, `token-${OPERATOR}`);
  });

  it('answers 404 to a person without it, and to a request with no session', async () => {
    jest.spyOn(oxyInternals, 'fetchRolesMe').mockImplementation(rolesMe(['other.key']));
    await request(appFor('oxy-someone-else')).get('/api/scraper/sources').expect(404);
    await request(appFor(null)).get('/api/scraper/sources').expect(404);
  });

  it('answers 503 for an Oxy outage, and never caches it as a "no"', async () => {
    const roles = jest
      .spyOn(oxyInternals, 'fetchRolesMe')
      .mockRejectedValueOnce(new OxyApiError('upstream', { status: 503, code: 'UNAVAILABLE' }))
      .mockImplementation(rolesMe([SCRAPER_OPERATE_PERMISSION]));
    const app = appFor(OPERATOR);
    const outage = await request(app).get('/api/scraper/sources').expect(503);
    expect(outage.body.error).toEqual(expect.objectContaining({ code: expect.any(String) }));
    await request(app).get('/api/scraper/sources').expect(200);
    expect(roles).toHaveBeenCalledTimes(2);
  });

  it('asks Oxy afresh on every call, so a revocation applies at once', async () => {
    const roles = jest
      .spyOn(oxyInternals, 'fetchRolesMe')
      .mockImplementationOnce(rolesMe([SCRAPER_OPERATE_PERMISSION]))
      .mockImplementation(rolesMe([]));
    const app = appFor(OPERATOR);
    await request(app).get('/api/scraper/sources').expect(200);
    await request(app).get('/api/scraper/sources').expect(404);
    expect(roles).toHaveBeenCalledTimes(2);
  });
});

describe('runExternalScrape', () => {
  const originalOrigins = process.env.SCRAPER_ALLOWED_ORIGINS;
  afterEach(() => {
    process.env.SCRAPER_ALLOWED_ORIGINS = originalOrigins;
  });

  it('never reaches an internal address, even one somebody allow-listed', async () => {
    // `localhost` stands in for a name that resolves to 169.254.170.2: a real
    // server that WOULD answer, so the only reason it is not reached is the
    // outbound fetch refusing it.
    let reached = false;
    const server = http.createServer((_req, res) => {
      reached = true;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('[]');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    process.env.SCRAPER_ALLOWED_ORIGINS = `http://localhost:${port}`;
    try {
      const result = await runExternalScrape({
        source: 'test',
        endpoint: `http://localhost:${port}/feed`,
        maxRetries: 1,
      });
      expect(reached).toBe(false);
      expect(result.totalProcessed).toBe(0);
      expect(result.errorDetails).toEqual([
        expect.objectContaining({ error: expect.stringContaining('Scrape failed') }),
      ]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
