import type { Request, Response } from 'express';

import { Profile, Conversation, isObjectId, getUserId, ok, err } from './shared';
import { generateAITitle, ChatMessage } from '../../services/aiService';

export async function listConversations(req: Request, res: Response) {
  const userId = getUserId(req as any);
  if (!userId) return err(res, 401, 'Unauthorized');

  const activeProfile = await Profile.findActiveByOxyUserId(userId);
  if (!activeProfile) return err(res, 404, 'No active profile found');

  const conversations = await Conversation.find({
    profileId: activeProfile._id.toString(),
  }).sort({ updatedAt: -1 });
  const transformed = conversations.map((c: any) => {
    const o = c.toObject({ virtuals: true });
    return {
      _id: o._id,
      id: o._id,
      title: o.title,
      status: o.status,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      messageCount: o.messages?.length || 0,
      lastMessage: o.messages?.[o.messages.length - 1] || null,
      messages: o.messages || [],
    };
  });

  return ok(res, { success: true, conversations: transformed });
}

export async function createConversation(req: Request, res: Response) {
  const userId = getUserId(req as any);
  if (!userId) return err(res, 401, 'Unauthorized');

  const activeProfile = await Profile.findActiveByOxyUserId(userId);
  if (!activeProfile) return err(res, 404, 'No active profile found');

  const { title, initialMessage, messages } = (req as any).body || {};

  let conversationMessages: ChatMessage[] = [];
  if (Array.isArray(messages)) {
    conversationMessages = messages.map((m: any) => ({
      role: m.role,
      content: m.content,
      timestamp: new Date(m.timestamp || Date.now()),
    }));
  } else if (initialMessage) {
    conversationMessages = [{ role: 'user', content: initialMessage, timestamp: new Date() }];
  }

  const conversation = new Conversation({
    profileId: activeProfile._id.toString(),
    title: title || 'New Conversation',
    messages: conversationMessages.map(m => ({
      role: m.role || 'user',
      content: m.content || '',
      timestamp: m.timestamp || new Date(),
    })),
    status: 'active',
  });

  const saved = await conversation.save();

  if (saved.messages.length && saved.title === 'New Conversation') {
    const firstUser = saved.messages.find((m: any) => m.role === 'user')?.content;
    if (firstUser) {
      const aiTitle = await generateAITitle(firstUser);
      if (aiTitle) {
        saved.title = aiTitle;
        await saved.save();
      }
    }
  }

  return ok(res, {
    success: true,
    conversation: {
      _id: saved._id,
      title: saved.title,
      messages: saved.messages,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
      status: saved.status,
    },
  });
}

export async function getConversation(req: Request, res: Response) {
  const userId = getUserId(req as any);
  if (!userId) return err(res, 401, 'Unauthorized');

  const conversationId = String((req as any).params.id || '');
  if (!conversationId || !isObjectId(conversationId)) {
    return err(res, 400, 'Invalid conversation ID');
  }

  const activeProfile = await Profile.findActiveByOxyUserId(userId);
  if (!activeProfile) return err(res, 404, 'No active profile found');

  const conversation = await Conversation.findOne({
    _id: conversationId,
    profileId: activeProfile._id.toString(),
  });
  if (!conversation) return err(res, 404, 'Conversation not found');

  return ok(res, { success: true, conversation });
}

export async function updateConversation(req: Request, res: Response) {
  const userId = getUserId(req as any);
  if (!userId) return err(res, 401, 'Unauthorized');

  const activeProfile = await Profile.findActiveByOxyUserId(userId);
  if (!activeProfile) return err(res, 404, 'No active profile found');

  const { title, messages, status } = (req as any).body || {};
  const conversation = await Conversation.findOne({
    _id: (req as any).params.id,
    profileId: activeProfile._id.toString(),
  });
  if (!conversation) return err(res, 404, 'Conversation not found');

  if (typeof title === 'string') conversation.title = title;
  if (Array.isArray(messages)) {
    conversation.messages = messages.map((m: any) => ({
      role: m.role,
      content: m.content,
      timestamp: new Date(m.timestamp || Date.now()),
    }));
  }
  if (typeof status === 'string') conversation.status = status;

  const saved = await conversation.save();
  return ok(res, { success: true, conversation: saved });
}

export async function addConversationMessage(req: Request, res: Response) {
  const userId = getUserId(req as any);
  if (!userId) return err(res, 401, 'Unauthorized');

  const activeProfile = await Profile.findActiveByOxyUserId(userId);
  if (!activeProfile) return err(res, 404, 'No active profile found');

  const { role, content, attachments } = (req as any).body || {};
  if (!role || !content) return err(res, 400, 'Role and content are required');

  const conversation = await Conversation.findOne({
    _id: (req as any).params.id,
    profileId: activeProfile._id.toString(),
  });
  if (!conversation) return err(res, 404, 'Conversation not found');

  const newMessage = { role, content, timestamp: new Date(), attachments: attachments || [] };
  conversation.messages.push(newMessage);
  await conversation.save();

  return ok(res, { success: true, message: newMessage, conversation });
}

export async function deleteConversation(req: Request, res: Response) {
  const userId = getUserId(req as any);
  if (!userId) return err(res, 401, 'Unauthorized');

  const activeProfile = await Profile.findActiveByOxyUserId(userId);
  if (!activeProfile) return err(res, 404, 'No active profile found');

  const deleted = await Conversation.findOneAndDelete({
    _id: (req as any).params.id,
    profileId: activeProfile._id.toString(),
  });
  if (!deleted) return err(res, 404, 'Conversation not found');

  return ok(res, { success: true, message: 'Conversation deleted' });
}

export async function shareConversation(req: Request, res: Response) {
  const userId = getUserId(req as any);
  if (!userId) return err(res, 401, 'Unauthorized');

  const activeProfile = await Profile.findActiveByOxyUserId(userId);
  if (!activeProfile) return err(res, 404, 'No active profile found');

  const conversation = await Conversation.findOne({
    _id: (req as any).params.id,
    profileId: activeProfile._id.toString(),
  });
  if (!conversation) return err(res, 404, 'Conversation not found');

  await conversation.generateShareToken();
  const token = conversation.sharing?.shareToken;
  if (!token) return err(res, 500, 'Failed to create share token');

  return ok(res, { success: true, shareToken: token, shareUrl: `/shared/${token}` });
}
