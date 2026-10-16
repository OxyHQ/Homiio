import type { Request, Response } from 'express';
import {
  beginTeamOperationSchema,
  teamOperationIdRequestSchema,
  HOMIIO_TEAM_OPERATION_HEADER,
} from '@oxy.so/homiio-contracts';
import {
  beginTeamOperation,
  finalizeTeamOperation,
  readTeamOperation,
  teamChatUrl,
} from '../../db/evictions/teamChatRepository';
import { getCaseTeam } from '../../db/evictions/collaboratorRepository';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import { oxyService } from '../../services/oxy';
import { AppError } from '../../middlewares/errorHandler';
function respondError(res: Response, error: unknown) {
  if (error instanceof AppError) {
    const status = error.statusCode;
    res.status(status).json({
      error: {
        code: status === 404 ? 'not_found' : status === 409 ? 'conflict' : 'validation_failed',
        message: error.message,
      },
    });
  } else
    res.status(503).json({
      error: { code: 'service_unavailable', message: 'Team chat is temporarily unavailable.' },
    });
}
export async function beginChatOperation(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  try {
    const parsed = beginTeamOperationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'bad_request', message: 'Invalid team operation.' } });
      return;
    }
    const actor = requireSessionOxyUserId(req);
    const team = await getCaseTeam(req.params.id, actor);
    if (!team?.isOwner) throw new AppError('Case not found', 404, 'not_found');
    if (parsed.data.action === 'add') {
      if (!parsed.data.oxyUserId || parsed.data.acknowledgeExactLocationAccess !== true)
        throw new AppError(
          'Confirm access to the exact address before adding a collaborator.',
          422,
          'validation_failed',
        );
      const target = await oxyService.users.get(parsed.data.oxyUserId, { cache: false });
      if (!target || target.id !== parsed.data.oxyUserId)
        throw new AppError('Account not found', 404, 'not_found');
    }
    res.json(await beginTeamOperation(req.params.id, actor, parsed.data));
  } catch (error) {
    respondError(res, error);
  }
}
export async function finalizeChatOperation(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  try {
    const parsed = teamOperationIdRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'bad_request', message: 'Invalid operation.' } });
      return;
    }
    res.json(await finalizeTeamOperation(parsed.data.operationId, requireSessionOxyUserId(req)));
  } catch (error) {
    respondError(res, error);
  }
}
export async function readChatOperation(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  try {
    const parsed = teamOperationIdRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'bad_request', message: 'Invalid operation.' } });
      return;
    }
    res.json(
      await readTeamOperation(parsed.data.operationId, req.get(HOMIIO_TEAM_OPERATION_HEADER) ?? ''),
    );
  } catch (error) {
    respondError(res, error);
  }
}
export async function getTeamChatUrl(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  try {
    res.json({ url: await teamChatUrl(req.params.id, requireSessionOxyUserId(req)) });
  } catch (error) {
    respondError(res, error);
  }
}
