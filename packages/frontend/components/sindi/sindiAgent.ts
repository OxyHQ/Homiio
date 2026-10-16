/**
 * Sindi, as Homiio opens it: an ordinary public Alia agent owned by the Homiio
 * project account (Alia ADR 0020 §1). Its prompt, families, ceiling and feature
 * gates are edited in Alia's agent editor; the only thing pinned here is the id
 * the app opens it by.
 */

/** Sindi's Alia agent id. */
export const SINDI_AGENT_ID = '01a0646a-078f-7514-9800-9f43ceed7df8';

/** The `agent` prop of the SDK's conversation surfaces. */
export const SINDI_AGENT = { id: SINDI_AGENT_ID } as const;

/**
 * The agents `useAskAgent().ask(key)` opens, in the one sheet: `alia` (no id —
 * Homiio's main AI) and `sindi`.
 */
export const HOMIIO_AGENTS = { alia: {}, sindi: SINDI_AGENT } as const;

export type HomiioAgentKey = keyof typeof HOMIIO_AGENTS;

/**
 * The `conversationId` of `/sindi/new`: a conversation Alia has not made yet.
 * The first turn makes it, and the route replaces itself with the real id.
 */
export const NEW_SINDI_CONVERSATION = 'new';
