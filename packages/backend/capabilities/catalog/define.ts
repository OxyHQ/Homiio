/**
 * How a Homiio catalogue tool is declared.
 *
 * Every tool acts on ONE resource: the effective account's root
 * (`homiio_account`, resource id = the account id). Which listing, lease or
 * case a call touches is an INPUT, and whether the account may touch it is
 * decided by the domain use case's repository query — the same query the
 * Express route runs — so a non-owner gets not-found from a tool exactly as it
 * does from the route.
 *
 * The helpers below fix the parts of a `CatalogTool` that follow from what the
 * tool is, so a declaration states only its name, contract and capability:
 *
 *  - `readTool`: package `read`, no effect, both lanes.
 *  - `actTool`: a non-financial write. Idempotency `supported` (a key, when the
 *    caller sends one, replays the stored receipt), both lanes.
 *  - `financeTool`: package `finance`, effect `financial`, idempotency
 *    `required`, a limit key on every amount, and the INTERNAL lane only — an
 *    OAuth grant carries no numeric ceiling, so exposing it over `/mcp` would let
 *    the caller pick its own maximum (Mercaria's `refundStoreOrder` precedent).
 *  - `featureCheckTool` / `featureConsumeTool`: the two halves of a catalogue
 *    `features[]` gate (Alia ADR 0020 §6), internal only, as the contract
 *    requires.
 *
 * Every invocation path is `POST /_oxy/capabilities/<name>`. Homiio's internal
 * transport is MCP (`internalTransport: 'mcp'`), so nothing routes on these
 * paths; they exist because the contract requires one per tool, and one
 * distinct static path per tool can never overlap another.
 */

import type { CatalogTool } from '@oxy.so/contracts';

export const HOMIIO_ACCOUNT_RESOURCE = 'homiio_account';
export const HOMIIO_TOOL_VERSION = '1.0.0';

type JsonSchema = Record<string, unknown>;
type LimitKeys = CatalogTool['limitKeys'];

export interface ToolSpec {
  name: string;
  description: string;
  /** Operation capability used to narrow external OAuth grants. */
  capability: string;
  input: JsonSchema;
  limitKeys?: LimitKeys;
}

/** Non-financial operation categories; these are not own app permission levels. */
export type ActPackage = 'create' | 'publish' | 'communicate' | 'administer';

const OBJECT_OUTPUT = { type: 'object', additionalProperties: true } as const;

function base(spec: ToolSpec) {
  return {
    name: spec.name,
    version: HOMIIO_TOOL_VERSION,
    description: spec.description,
    inputSchema: spec.input,
    outputSchema: OBJECT_OUTPUT,
    requiredCapabilities: [spec.capability],
    resourceTypes: [HOMIIO_ACCOUNT_RESOURCE],
    limitKeys: spec.limitKeys ?? [],
    invocation: { method: 'POST' as const, path: `/_oxy/capabilities/${spec.name}` },
  };
}

export function readTool(spec: ToolSpec): CatalogTool {
  return {
    ...base(spec),
    capabilityPackage: 'read',
    effect: 'read',
    idempotency: 'none',
    rollback: 'none',
    exposure: ['internal', 'mcp'],
  };
}

export function actTool(
  spec: ToolSpec & { capabilityPackage: ActPackage; rollback?: CatalogTool['rollback'] },
): CatalogTool {
  return {
    ...base(spec),
    capabilityPackage: spec.capabilityPackage,
    effect: 'write',
    idempotency: 'supported',
    rollback: spec.rollback ?? 'none',
    exposure: ['internal', 'mcp'],
  };
}

export function financeTool(spec: ToolSpec & { limitKeys: LimitKeys }): CatalogTool {
  return {
    ...base(spec),
    capabilityPackage: 'finance',
    effect: 'financial',
    idempotency: 'required',
    rollback: 'none',
    exposure: ['internal'],
  };
}

export function featureCheckTool(spec: ToolSpec): CatalogTool {
  return { ...readTool(spec), exposure: ['internal'] };
}

export function featureConsumeTool(spec: ToolSpec): CatalogTool {
  return {
    ...base(spec),
    capabilityPackage: 'create',
    effect: 'write',
    idempotency: 'required',
    rollback: 'none',
    exposure: ['internal'],
  };
}

// ── Input schema building blocks ────────────────────────────────────────────

export const idInput = { type: 'string', minLength: 1, maxLength: 255 } as const;
export const textInput = (maxLength: number) =>
  ({ type: 'string', minLength: 1, maxLength }) as const;
export const optionalTextInput = (maxLength: number) => ({ type: 'string', maxLength }) as const;
export const pageInput = { type: 'integer', minimum: 1, maximum: 10_000 } as const;
export const limitInput = { type: 'integer', minimum: 1, maximum: 100 } as const;
export const booleanInput = { type: 'boolean' } as const;
export const isoDateInput = {
  type: 'string',
  minLength: 10,
  maxLength: 40,
  description: 'ISO 8601 date or date-time.',
} as const;
export const enumInput = (values: readonly string[]) =>
  ({ type: 'string', enum: [...values] }) as const;
/** A free-form JSON object the domain validates (field whitelists live there). */
export const openObjectInput = (description: string) =>
  ({ type: 'object', additionalProperties: true, description }) as const;

export function objectInput(
  properties: Record<string, unknown>,
  required: readonly string[] = [],
): JsonSchema {
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required: [...required] } : {}),
    additionalProperties: false,
  };
}
