/**
 * Eviction case comments (public coordination thread).
 *
 *   - listEvictionCaseComments — public, newest-first, paginated.
 *   - commentOnEvictionCase    — notifies the case owner (unless self-comment).
 *   - deleteEvictionCaseComment — the comment author OR the case owner may
 *     remove it; anyone else gets a 404 (no existence leak).
 *
 * The owner check is `findOwnedEvictionCase`, the same single predicate every
 * eviction write uses, so there is one spelling of case ownership in the domain.
 */

import {
  deleteEvictionComment,
  findEvictionCase,
  findEvictionComment,
  findOwnedEvictionCase,
  insertEvictionComment,
  listEvictionComments,
} from '../../db/evictions/evictionRepository';
import { AppError } from '../../middlewares/errorHandler';
import { pickFields } from '../../utils/pickFields';
import { notificationDispatchService } from '../../services/notificationDispatchService';
import { parsePagination } from './shared';
import { toEvictionCommentDTO } from './toEvictionDTO';

const MAX_BODY_LENGTH = 2000;

/** One page of a case's comments, newest first. */
export async function listEvictionCaseComments(
  id: string,
  query: Readonly<Record<string, unknown>>,
) {
  const { page, limit, skip } = parsePagination(query);
  const { total, comments } = await listEvictionComments(id, { limit, skip });
  const totalPages = Math.ceil(total / limit);
  return {
    comments: comments.map(toEvictionCommentDTO),
    pagination: { page, limit, total, totalPages },
    hasMore: skip + comments.length < total,
    totalPages,
    total,
    page,
  };
}

/** Post a comment on a case's public thread. */
export async function commentOnEvictionCase(oxyUserId: string, id: string, body: unknown) {
  const evictionCase = await findEvictionCase(id);
  if (!evictionCase) throw new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND');

  const picked = pickFields<Record<string, unknown>>(body, ['body']);
  const text = typeof picked.body === 'string' ? picked.body.trim() : '';
  if (!text) throw new AppError('A comment body is required', 400, 'INVALID_COMMENT');
  if (text.length > MAX_BODY_LENGTH)
    throw new AppError('Comment is too long', 400, 'COMMENT_TOO_LONG');

  const comment = await insertEvictionComment({ caseId: id, oxyUserId, body: text });

  if (evictionCase.oxyUserId !== oxyUserId) {
    await notificationDispatchService.createForUser(evictionCase.oxyUserId, {
      type: 'eviction_comment',
      title: 'New comment on your eviction case',
      message: `Someone commented on "${evictionCase.title}"`,
      data: { evictionId: id, commentId: comment.id },
    });
  }

  return toEvictionCommentDTO(comment);
}

/** Remove a comment: its author, or the case owner moderating their own thread. */
export async function deleteEvictionCaseComment(oxyUserId: string, id: string, commentId: string) {
  const comment = await findEvictionComment(id, commentId);
  if (!comment) throw new AppError('Comment not found', 404, 'COMMENT_NOT_FOUND');

  const authorized =
    comment.oxyUserId === oxyUserId || (await findOwnedEvictionCase(id, oxyUserId)) !== undefined;
  // Non-author, non-owner → 404 (never reveal the comment exists).
  if (!authorized) throw new AppError('Comment not found', 404, 'COMMENT_NOT_FOUND');

  await deleteEvictionComment(id, commentId);
}
