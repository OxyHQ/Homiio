import type { CatalogTool } from '@oxy.so/contracts';
import { featureCheckTool, featureConsumeTool, objectInput } from './define';

/**
 * The `sindi.files` feature gate (Alia ADR 0020 §6). Internal only, as the
 * catalogue contract requires of a feature's check and consume tools: Alia
 * calls them under the requester's ticket before it reads a file the person
 * attached, and consumes BEFORE it reserves any credit of its own.
 */
export const ENTITLEMENT_TOOLS: readonly CatalogTool[] = [
  featureCheckTool({
    name: 'readFileEntitlement',
    description:
      'Whether the person may use files (contract review, photo analysis) right now: Homiio+ unlocks them; otherwise each use spends one file credit. Answers { available, plusActive, fileCredits, consumesCredit }.',
    capability: 'housing.entitlements.read',
    input: objectInput({}),
  }),
  featureConsumeTool({
    name: 'consumeFileCredit',
    description:
      'Spend one file credit for one use of a file, or confirm Homiio+ makes it free. Refuses with NO_CREDITS (402) when the person has neither. Idempotent per key: a retried turn spends once.',
    capability: 'housing.entitlements.consume',
    input: objectInput({}),
  }),
];
