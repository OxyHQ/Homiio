import type { Request, Response } from 'express';

import { Profile, getUserId, ok, err } from './shared';

export async function getHistory(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user) return err(res, 401, 'Unauthorized');
  const history = (user.chatHistory || []).slice().reverse();
  return ok(res, { success: true, history });
}

export async function clearHistory(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user) return err(res, 401, 'Unauthorized');
  user.chatHistory = [];
  await user.save();
  return ok(res, { success: true });
}

export async function appendHistory(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) return err(res, 401, 'Unauthorized');

  const profile = await Profile.findOne({ oxyUserId: userId, profileType: 'personal' });
  if (!profile) return err(res, 404, 'Personal profile not found');

  const { userMessage, assistantMessage } = (req as any).body || {};
  if (!userMessage || !assistantMessage) return err(res, 400, 'Missing userMessage or assistantMessage');

  profile.chatHistory = profile.chatHistory || [];
  const now = new Date();
  profile.chatHistory.push({ role: 'user', content: userMessage, timestamp: now });
  profile.chatHistory.push({ role: 'assistant', content: assistantMessage, timestamp: now });
  if (profile.chatHistory.length > 100) profile.chatHistory = profile.chatHistory.slice(-100);
  await profile.save();

  return ok(res, { success: true });
}

export function health(_req: Request, res: Response) {
  return ok(res, {
    status: 'ok',
    service: 'AI Streaming Service',
    features: ['text-streaming', 'image-input', 'pdf-file-input'],
    timestamp: new Date().toISOString(),
  });
}
