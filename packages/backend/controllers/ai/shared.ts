import type { Request, Response } from 'express';
import mongoose from 'mongoose';

import { Profile, Conversation } from '../../models';

export { Profile, Conversation };

export const isObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);
export const getUserId = (req: any) => req.user?.oxyUserId || req.user?._id || req.user?.id;

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
