/**
 * Homiio's host tools, as Alia's wire contract declares them
 * (`docs/agent-embedding.md` §2 in the Alia repository).
 *
 * Pure: no React, no router. The definitions come from
 * `shared-types/sindiAction.ts#SINDI_HOST_TOOLS`, which builds each tool's JSON
 * Schema and its parser from one field table, so the declaration and the
 * validation cannot drift. The executor (`hooks/useSindiActions.ts`) performs
 * the action; this module only says what the model is told and what it reads
 * back.
 */

import type { AliaHostAction, AliaHostOutcome, AliaHostToolDefinition } from '@alia.onl/sdk';
import {
  parseSindiHostCall,
  SINDI_HOST_TOOLS,
  type SindiAction,
  type SindiActionOutcome,
} from '@homiio/shared-types';

/** The app slug the tools are declared under: the model sees `host_homiio__<name>`. */
export const SINDI_HOST_APP = 'homiio';

/** What Homiio declares with every turn. */
export const SINDI_HOST_TOOL_DEFINITIONS: readonly AliaHostToolDefinition[] = SINDI_HOST_TOOLS.map(
  ({ name, description, inputSchema }) => ({ name, description, inputSchema: { ...inputSchema } }),
);

/** The action an `alia.host_action` asks for, or `null` when it is not Homiio's or not in the contract. */
export function actionOfHostCall(call: AliaHostAction): SindiAction | null {
  if (call.app !== SINDI_HOST_APP) return null;
  return parseSindiHostCall(call.name, call.input);
}

/**
 * What the model reads back, in its own language (English: the model reads it,
 * the person never does). Each line says what is now TRUE, so the reply that
 * follows cannot claim a change the executor did not make (#519 §8.4).
 */
const OUTCOME_DETAIL: Readonly<Record<SindiActionOutcome, string>> = {
  applied:
    'Done: the page under this chat now shows it, and the chat closes once your answer is written.',
  rejected: 'Refused: the input is outside the tool’s contract. Nothing changed.',
  stale:
    'Not performed: the person changed the search themselves during this turn, and their change wins. Nothing was overridden.',
  failed: 'Could not be done in the app (the area cannot be shown on Explore). Nothing changed.',
};

/** The outcome as the SDK sends it with the next request. */
export function hostOutcomeOf(outcome: SindiActionOutcome): AliaHostOutcome {
  return { outcome, detail: OUTCOME_DETAIL[outcome] };
}
