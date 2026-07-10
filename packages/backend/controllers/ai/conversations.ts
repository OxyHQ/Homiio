import type { Request, Response } from 'express';

import { Conversation, isObjectId, getUserId, ok, err } from './shared';
import { generateAITitle, ChatMessage } from '../../services/aiService';

export async function listConversations(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) return err(res, 401, 'Unauthorized');

  const conversations = await Conversation.find({
    oxyUserId: userId,
  }).sort({ updatedAt: -1 });
  const transformed = conversations.map((c: { toObject: (opts: { virtuals: boolean }) => Record<string, unknown> }) => {
    const o = c.toObject({ virtuals: true });
    const messages = Array.isArray(o.messages) ? o.messages : [];
    return {
      _id: o._id,
      id: o._id,
      title: o.title,
      status: o.status,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      messageCount: messages.length,
      lastMessage: messages[messages.length - 1] || null,
      messages,
    };
  });

  return ok(res, { success: true, conversations: transformed });
}

export async function createConversation(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) return err(res, 401, 'Unauthorized');

  const { title, initialMessage, messages } = (req as { body?: Record<string, unknown> }).body || {};

  let conversationMessages: ChatMessage[] = [];
  if (Array.isArray(messages)) {
    conversationMessages = messages.map((m: { role?: string; content?: string; timestamp?: string | number | Date }) => ({
      role: (m.role ?? 'user') as 'user' | 'assistant' | 'system',
      content: m.content ?? '',
      timestamp: new Date(m.timestamp || Date.now()),
    }));
  } else if (initialMessage) {
    conversationMessages = [{ role: 'user', content: String(initialMessage), timestamp: new Date() }];
  }

  const conversation = new Conversation({
    oxyUserId: userId,
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
    const firstUser = saved.messages.find((m: { role?: string; content?: string }) => m.role === 'user')?.content;
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
  const userId = getUserId(req);
  if (!userId) return err(res, 401, 'Unauthorized');

  const conversationId = String((req as { params?: { id?: string } }).params?.id || '');
  if (!conversationId || !isObjectId(conversationId)) {
    return err(res, 400, 'Invalid conversation ID');
  }

  const conversation = await Conversation.findOne({
    _id: conversationId,
    oxyUserId: userId,
  });
  if (!conversation) return err(res, 404, 'Conversation not found');

  return ok(res, { success: true, conversation });
}

export async function updateConversation(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) return err(res, 401, 'Unauthorized');

  const { title, messages, status } = (req as { body?: Record<string, unknown>; params?: { id?: string } }).body || {};
  const conversation = await Conversation.findOne({
    _id: (req as { params?: { id?: string } }).params?.id,
    oxyUserId: userId,
  });
  if (!conversation) return err(res, 404, 'Conversation not found');

  if (typeof title === 'string') conversation.title = title;
  if (Array.isArray(messages)) {
    conversation.messages = messages.map((m: { role?: string; content?: string; timestamp?: string | number | Date }) => ({
      role: (m.role ?? 'user') as 'user' | 'assistant' | 'system',
      content: m.content ?? '',
      timestamp: new Date(m.timestamp || Date.now()),
    }));
  }
  if (typeof status === 'string') conversation.status = status;

  const saved = await conversation.save();
  return ok(res, { success: true, conversation: saved });
}

export async function addConversationMessage(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) return err(res, 401, 'Unauthorized');

  const { role, content, attachments } = (req as { body?: { role?: string; content?: string; attachments?: unknown[] }; params?: { id?: string } }).body || {};
  if (!role || !content) return err(res, 400, 'Role and content are required');
  if (role !== 'user' && role !== 'assistant' && role !== 'system') {
    return err(res, 400, 'Invalid message role');
  }

  const conversation = await Conversation.findOne({
    _id: (req as { params?: { id?: string } }).params?.id,
    oxyUserId: userId,
  });
  if (!conversation) return err(res, 404, 'Conversation not found');

  const attachmentsList = Array.isArray(attachments) ? attachments : [];
  const newMessage = {
    role: role as 'user' | 'assistant' | 'system',
    content,
    timestamp: new Date(),
    attachments: attachmentsList as Array<{ type?: string; name?: string; url?: string; size?: number }>,
  };
  conversation.messages.push(newMessage);
  await conversation.save();

  return ok(res, { success: true, message: newMessage, conversation });
}

export async function deleteConversation(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) return err(res, 401, 'Unauthorized');

  const deleted = await Conversation.findOneAndDelete({
    _id: (req as { params?: { id?: string } }).params?.id,
    oxyUserId: userId,
  });
  if (!deleted) return err(res, 404, 'Conversation not found');

  return ok(res, { success: true, message: 'Conversation deleted' });
}

export async function shareConversation(req: Request, res: Response) {
  const userId = getUserId(req);
  if (!userId) return err(res, 401, 'Unauthorized');

  const conversation = await Conversation.findOne({
    _id: (req as { params?: { id?: string } }).params?.id,
    oxyUserId: userId,
  });
  if (!conversation) return err(res, 404, 'Conversation not found');

  await conversation.generateShareToken();
  const token = conversation.sharing?.shareToken;
  if (!token) return err(res, 500, 'Failed to create share token');

  return ok(res, { success: true, shareToken: token, shareUrl: `/shared/${token}` });
}
