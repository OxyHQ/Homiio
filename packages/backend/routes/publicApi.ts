import { readChatOperation } from '../controllers/eviction/teamChat';
import { Router, type ErrorRequestHandler } from 'express';
import { generateOpenApi } from '@oxy.so/homiio-contracts/dist/openapi';
import { getPublicCaseCards } from '../controllers/eviction/publicCards';
import { oxyService } from '../services/oxy';

export const publicApiRouter = Router();
publicApiRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
publicApiRouter.get('/openapi.json', (_req, res) => res.json(generateOpenApi()));
publicApiRouter.post('/cases/batch', getPublicCaseCards);
/**
 * A service read: the caller's Oxy service token (Homiio's `expectedAudience`)
 * is its transport identity, the operation capability the resource grant.
 * Neither replaces the other. `@oxy.so/homiio-sdk/server` sends both.
 */
publicApiRouter.post(
  '/team-chat/operations/read',
  oxyService.middleware.service(),
  readChatOperation,
);
publicApiRouter.use((_req, res) =>
  res.status(404).json({
    error: {
      code: 'unknown_route',
      message: 'Unknown public API route.',
    },
  }),
);

export const publicApiBodyErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (!req.path.startsWith('/api/v1/')) return next(error);
  res.set('Cache-Control', 'no-store');
  return res.status(400).json({ error: { code: 'bad_request', message: 'Invalid request body.' } });
};
