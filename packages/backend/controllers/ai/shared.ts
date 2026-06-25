import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { getOxyUserId } from '@oxyhq/core/server';

import { Profile, Conversation } from '../../models';

export { Profile, Conversation };

export const isObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);
/**
 * Resolve the authenticated Oxy user id (or null) from a request whose session
 * was already populated by `@oxyhq/core/server` auth middleware mounted in
 * server.ts. Returns null for anonymous requests so callers can emit their own
 * 401 shape.
 */
export const getUserId = (req: Request): string | null => getOxyUserId(req);

export const ok = (res: Response, data: any) => res.json(data);
export const err = (res: Response, code: number, message: string) =>
  res.status(code).json({ error: message });

export const setStreamingHeaders = (res: Response) => {
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  (res as any).setTimeout?.(0);
};

export const onGracefulClose = (req: Request, res: Response) => {
  const onClose = () => {
    try {
  (res as any).end?.();
    } catch (e) {
      // best-effort: response already closed
    }
  };
  req.on('aborted', onClose);
  res.on('close', onClose);
};
