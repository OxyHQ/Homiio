/**
 * Eviction case comments (public coordination thread).
 *
 *   - listComments   — public, newest-first, paginated.
 *   - createComment  — authed; notifies the case owner (unless self-comment).
 *   - deleteComment  — the comment author OR the case owner may remove it;
 *                      anyone else gets a 404 (no existence leak).
 */

import { pickFields } from '../../utils/pickFields';
import { EvictionCase, EvictionComment } from '../../models';
import { toEvictionCommentDTO } from './toEvictionDTO';
import { parsePagination } from './shared';
import { notificationDispatchService } from '../../services/notificationDispatchService';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

const MAX_BODY_LENGTH = 2000;

export async function listComments(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { id } = req.params;
    const { page, limit, skip } = parsePagination(req.query);

    const filter = { caseId: id };
    const [total, comments] = await Promise.all([
      EvictionComment.countDocuments(filter),
      EvictionComment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    const totalPages = Math.ceil(total / limit);
    res.json(
      successResponse(
        {
          comments: comments.map(toEvictionCommentDTO),
          pagination: { page, limit, total, totalPages },
          hasMore: skip + comments.length < total,
          totalPages,
          total,
          page,
        },
        'Comments',
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function createComment(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    const evictionCase = await EvictionCase.findById(id).select('oxyUserId title');
    if (!evictionCase) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    const picked = pickFields<Record<string, unknown>>(req.body, ['body']);
    const body = typeof picked.body === 'string' ? picked.body.trim() : '';
    if (!body) return next(new AppError('A comment body is required', 400, 'INVALID_COMMENT'));
    if (body.length > MAX_BODY_LENGTH) return next(new AppError('Comment is too long', 400, 'COMMENT_TOO_LONG'));

    const comment = await EvictionComment.create({ caseId: id, oxyUserId, body });

    if (evictionCase.oxyUserId && evictionCase.oxyUserId !== oxyUserId) {
      await notificationDispatchService.createForUser(evictionCase.oxyUserId, {
        type: 'eviction_comment',
        title: 'New comment on your eviction case',
        message: `Someone commented on "${evictionCase.title}"`,
        data: { evictionId: String(id), commentId: String(comment._id) },
      });
    }

    res.status(201).json(successResponse(toEvictionCommentDTO(comment), 'Comment posted'));
  } catch (error) {
    next(error);
  }
}

export async function deleteComment(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { id, commentId } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    const comment = await EvictionComment.findOne({ _id: commentId, caseId: id });
    if (!comment) return next(new AppError('Comment not found', 404, 'COMMENT_NOT_FOUND'));

    let authorized = comment.oxyUserId === oxyUserId;
    if (!authorized) {
      // The case owner may also moderate the thread.
      const evictionCase = await EvictionCase.findById(id).select('oxyUserId');
      authorized = Boolean(evictionCase && evictionCase.oxyUserId === oxyUserId);
    }
    // Non-author, non-owner → 404 (never reveal the comment exists).
    if (!authorized) return next(new AppError('Comment not found', 404, 'COMMENT_NOT_FOUND'));

    await EvictionComment.deleteOne({ _id: commentId, caseId: id });
    res.json(successResponse(null, 'Comment deleted'));
  } catch (error) {
    next(error);
  }
}
