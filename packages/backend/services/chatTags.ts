/**
 * The tags a Sindi chat message may carry, read by INDEX rather than by regex.
 *
 * ## Why not a regex
 *
 * `<TAG>([\s\S]*?)</TAG>` is the obvious spelling and it is a polynomial
 * ReDoS: with a lazy quantifier the engine restarts its inner scan at every
 * opening tag, so a message made of many `<FILE_DATA_URL>` starts and no
 * closing tag is quadratic in its own length. CodeQL flagged three of them on
 * `routes/ai.ts`. The content is a user-supplied chat message arriving on an
 * authenticated endpoint, so the blast radius is one request's own CPU —
 * small, real, and free to remove.
 *
 * `indexOf` has no backtracking at all. The frontend's `propertyParsing.ts`
 * already reads `<PROPERTIES_JSON>` this way, for the same reason, so this is
 * the shape the two sides now share rather than a new invention.
 *
 * ## Why this is its own module
 *
 * `routes/ai.ts` is a 1,500-line router that opens a database, a multer
 * instance and an inference client at import time. These four functions are
 * pure string handling, and a test of "does an unclosed tag cost quadratic
 * time?" should not have to mount a router to ask.
 */

import { describeErrorForLog } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';

/** The roles a chat transcript carries. Declared here, not imported from the router. */
export interface TaggedChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content?: string;
}

export const IMAGE_DATA_URL_TAG = 'IMAGE_DATA_URL';
export const FILE_DATA_URL_TAG = 'FILE_DATA_URL';
export const PROPERTIES_JSON_TAG = 'PROPERTIES_JSON';

/**
 * The payload between a tag's open and close, or `null`.
 *
 * Case-insensitive on the TAG, which is what the regexes were; the payload is
 * returned verbatim, because a property id inside `<PROPERTIES_JSON>` must
 * survive this function unchanged.
 */
export function taggedContent(content: string, tag: string): string | null {
  const haystack = content.toLowerCase();
  const open = `<${tag.toLowerCase()}>`;
  const close = `</${tag.toLowerCase()}>`;
  const start = haystack.indexOf(open);
  if (start === -1) return null;
  const end = haystack.indexOf(close, start + open.length);
  if (end === -1) return null;
  return content.slice(start + open.length, end);
}

/** Remove the first occurrence of a tag and its payload. Linear, like the read. */
export function withoutTag(content: string, tag: string): string {
  const haystack = content.toLowerCase();
  const open = `<${tag.toLowerCase()}>`;
  const close = `</${tag.toLowerCase()}>`;
  const start = haystack.indexOf(open);
  if (start === -1) return content;
  const end = haystack.indexOf(close, start + open.length);
  if (end === -1) return content;
  return content.slice(0, start) + content.slice(end + close.length);
}

/**
 * The property ids the LAST assistant message offered, for a "show me others"
 * follow-up.
 *
 * Only an ASSISTANT message is read: a person can type anything, and the ids
 * this returns are used to anchor a nearby search and to exclude what has
 * already been shown.
 */
export const extractLastPropertyIdsFromMessages = (msgs: readonly TaggedChatMessage[]): string[] => {
  for (const m of [...msgs].reverse()) {
    if (m.role !== 'assistant' || !m.content) continue;
    const payload = taggedContent(m.content, PROPERTIES_JSON_TAG);
    if (payload === null) continue;
    try {
      const arr = JSON.parse(payload.trim());
      if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
    } catch (error: unknown) {
      logger.warn('Failed to parse <PROPERTIES_JSON> block from assistant message', {
        error: describeErrorForLog(error),
      });
    }
  }
  return [];
};
