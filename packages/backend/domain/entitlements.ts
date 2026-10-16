/**
 * Homiio+ entitlements: what the person's plan unlocks, and spending a file
 * credit.
 *
 * Two callers share these: the `/api/profiles/me/entitlements` routes the app
 * reads, and the `sindi.files` feature gate (`readFileEntitlement` /
 * `consumeFileCredit` tools) Alia checks before it reads a file the person
 * attached. Before the gate existed, the app only ever READ the credit count to
 * lock its file picker and no path spent one, so a non-subscriber with one
 * credit could review documents forever. The gate's consume is the spend.
 */

import {
  consumeFileCredit as consumeFileCreditRow,
  ensureBilling,
  readEntitlements,
} from '../db/billing/billingRepository';
import { AppError } from '../middlewares/errorHandler';

/** What the entitlements route answers; a person who never paid has the zeroed shape. */
export async function readAccountEntitlements(oxyUserId: string) {
  // Deliberately NOT created on read: an entitlements GET that mints a billing
  // row would put a write on every page load.
  return (
    (await readEntitlements(oxyUserId)) ?? {
      plusActive: false,
      fileCredits: 0,
      founderSupporter: false,
      processedSessions: [],
    }
  );
}

export interface FileEntitlement {
  /** Whether the person may use files right now. */
  readonly available: boolean;
  readonly plusActive: boolean;
  readonly fileCredits: number;
  /** Whether using a file spends a credit (false with Homiio+). */
  readonly consumesCredit: boolean;
}

export async function readFileEntitlement(oxyUserId: string): Promise<FileEntitlement> {
  const entitlements = await readAccountEntitlements(oxyUserId);
  const plusActive = entitlements.plusActive === true;
  const fileCredits = Number(entitlements.fileCredits ?? 0);
  return {
    available: plusActive || fileCredits > 0,
    plusActive,
    fileCredits,
    consumesCredit: !plusActive,
  };
}

export interface FileCreditSpend {
  readonly consumed: boolean;
  readonly remaining: number | 'unlimited';
}

/**
 * Spend one file credit, or confirm Homiio+ makes it free.
 *
 * ONE guarded statement decides it (`consumeFileCreditRow` carries the
 * `file_credits > 0` predicate into the UPDATE), so two concurrent spends
 * cannot both take the last credit. Out of credits is the route's 402.
 */
export async function consumeFileCredit(oxyUserId: string): Promise<FileCreditSpend> {
  // Created on first spend rather than on read: this is a write either way.
  await ensureBilling(oxyUserId);
  const result = await consumeFileCreditRow(oxyUserId);
  if (!result.consumed && result.remaining !== 'unlimited') {
    throw new AppError('No file credits', 402, 'NO_CREDITS');
  }
  return { consumed: result.consumed, remaining: result.remaining };
}
