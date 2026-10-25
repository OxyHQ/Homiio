import type { DocumentRequester } from '../../services/files/requester';
/**
 * What a Homiio tool handler receives, and the helpers that read its input.
 *
 * A handler is `(input, context) => result`. `context.accountId` is THE
 * effective account — the verified capability ticket's `effectiveAccountId`
 * on `/_oxy/mcp`, the OAuth connection's active account on `/mcp` — and it is
 * the only identity a handler may pass to a domain use case. Never read an
 * account, owner or user id from `input` as an authority, and never call
 * `requireSessionOxyUserId`: there is no Express session on this lane.
 *
 * The input has already been validated against the tool's JSON Schema by the
 * transport (unknown keys refused, types checked), so the readers below only
 * narrow types for TypeScript; the domain still validates meaning.
 *
 * A handler returns a plain object. `homiio.handlers.ts` turns it into the MCP
 * result through the same wire-id serializer and JSON round trip `res.json`
 * applies, so a tool answers exactly what the route answers.
 */

import type { CatalogTool } from '@oxy.so/contracts';
import { AppError } from '../../middlewares/errorHandler';

export interface HomiioToolContext {
  /** The effective Homiio account (an Oxy user id). The ONLY authority. */
  readonly accountId: string;
  readonly fileRequester?: DocumentRequester;
  readonly tool: CatalogTool;
  /** The caller's idempotency key, when it sent one (always, for `required`). */
  readonly idempotencyKey?: string;
}

export type ToolInput = Readonly<Record<string, unknown>>;
export type ToolResult = Record<string, unknown>;
export type HomiioToolHandler = (
  input: ToolInput,
  context: HomiioToolContext,
) => Promise<ToolResult>;
export type HomiioToolHandlers = Readonly<Record<string, HomiioToolHandler>>;

function invalid(key: string, expected: string): AppError {
  return new AppError(`${key} must be ${expected}`, 400, 'VALIDATION_ERROR');
}

export function requiredString(input: ToolInput, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0) throw invalid(key, 'a string');
  return value;
}

export function optionalString(input: ToolInput, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid(key, 'a string');
  return value;
}

export function optionalNumber(input: ToolInput, key: string): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(key, 'a number');
  return value;
}

export function requiredNumber(input: ToolInput, key: string): number {
  const value = optionalNumber(input, key);
  if (value === undefined) throw invalid(key, 'a number');
  return value;
}

export function optionalInteger(input: ToolInput, key: string): number | undefined {
  const value = optionalNumber(input, key);
  if (value !== undefined && !Number.isInteger(value)) throw invalid(key, 'an integer');
  return value;
}

export function optionalBoolean(input: ToolInput, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw invalid(key, 'a boolean');
  return value;
}

export function optionalObject(input: ToolInput, key: string): Record<string, unknown> | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid(key, 'an object');
  return value as Record<string, unknown>;
}

export function requiredObject(input: ToolInput, key: string): Record<string, unknown> {
  const value = optionalObject(input, key);
  if (value === undefined) throw invalid(key, 'an object');
  return value;
}

export function optionalStringArray(input: ToolInput, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw invalid(key, 'an array of strings');
  }
  return value as string[];
}

/**
 * A query-string-shaped record for a domain use case that still reads the
 * route's query parameters: every present scalar input becomes the string the
 * route would have received, arrays become comma-joined lists.
 */
export function asQuery(input: ToolInput): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    query[key] = Array.isArray(value) ? value.map(String).join(',') : String(value);
  }
  return query;
}
