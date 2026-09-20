/**
 * What a landlord asked for, what arrived, and what they have actually checked
 * (#518 §7.4, #519 §7.4).
 *
 * §7.4: "El checklist debe reflejar estados verdaderos de requisitos, upload y
 * verificación. Pulsar un botón no convierte localmente un documento en
 * verificado."
 *
 * Three facts, and they are three because they can disagree. A landlord asks
 * for proof of income; the applicant uploads something; somebody has to open it
 * and decide it is what was asked for. A checklist that collapsed any two of
 * those would be able to show a tick for a document nobody had read.
 *
 * ## Derived, not stored
 *
 * There is no checklist table. A row here is computed from the property's
 * requirement list and the application's documents, so the checklist and the
 * documents cannot come to disagree — which is what a second table would
 * eventually let them do. Verification IS stored, because it is a decision
 * somebody made rather than a consequence of other rows.
 *
 * ## Why verification lives on the document
 *
 * A requirement is answered by a FILE, and it is the file a landlord opens and
 * judges. Recording the verdict against the requirement instead would leave
 * "verified" attached to a slot while the document in it changed.
 */

import type { TenantApplicationDocumentType } from './application';

/**
 * Where one document stands with the landlord.
 *
 * `pending` is the state every uploaded document starts in, and it is a real
 * answer rather than an absence: "nobody has looked at this yet" is what an
 * applicant most needs to be able to see.
 */
export const DOCUMENT_VERIFICATION_STATUSES = ['pending', 'verified', 'rejected'] as const;
export type DocumentVerificationStatus = (typeof DOCUMENT_VERIFICATION_STATUSES)[number];

/** A document as the checklist sees it. */
export interface ChecklistDocument {
  readonly id: string;
  readonly type: TenantApplicationDocumentType;
  readonly filename: string;
  readonly verification: DocumentVerificationStatus;
  /** Why it was rejected. Present only when `verification` is `rejected`. */
  readonly rejectionReason?: string;
  readonly verifiedAt?: string;
}

/**
 * One line of the checklist.
 *
 * `required` and `documents` are separate on purpose: a document can arrive for
 * something nobody asked for (a tenant volunteering a reference), and a
 * requirement can sit with nothing against it. Both are ordinary, and a shape
 * that could only express "requirement with document" would have to drop one
 * of them.
 */
export interface ChecklistItem {
  readonly type: TenantApplicationDocumentType;
  /** The landlord asked for this one. */
  readonly required: boolean;
  readonly documents: readonly ChecklistDocument[];
  readonly status: ChecklistItemStatus;
}

/**
 * What a line has actually reached.
 *
 *  - `missing` — asked for, nothing uploaded.
 *  - `awaiting_review` — uploaded, nobody has judged it.
 *  - `verified` — the landlord opened it and said it is what they asked for.
 *  - `rejected` — they said it is not, with a reason the applicant can read.
 *
 * There is no `complete`: a line is `verified` only when somebody verified it,
 * and calling an unread upload complete is precisely the local tick §7.4
 * forbids.
 */
export const CHECKLIST_ITEM_STATUSES = [
  'missing',
  'awaiting_review',
  'verified',
  'rejected',
] as const;
export type ChecklistItemStatus = (typeof CHECKLIST_ITEM_STATUSES)[number];

/**
 * Build the checklist.
 *
 * Total over the union of what was required and what was uploaded, so a
 * volunteered document is shown (`required: false`) rather than hidden, and a
 * requirement with nothing against it is shown as `missing` rather than
 * omitted. Ordered by the requirement list first, then by whatever else
 * arrived, so the landlord's own ordering is what the applicant reads.
 *
 * ## The status rules, in order
 *
 * A line with several documents takes the BEST outcome that any of them
 * reached, not the worst and not the newest: an applicant who uploaded a
 * payslip that was rejected and then a contract that was verified has satisfied
 * the requirement, and showing the line as rejected would tell them to do
 * something they have already done. The rejected document is still listed, with
 * its reason, so nothing is hidden.
 */
export function applicationChecklist(
  required: readonly TenantApplicationDocumentType[],
  documents: readonly ChecklistDocument[],
): ChecklistItem[] {
  const order: TenantApplicationDocumentType[] = [];
  const seen = new Set<TenantApplicationDocumentType>();
  for (const type of [...required, ...documents.map((document) => document.type)]) {
    if (seen.has(type)) continue;
    seen.add(type);
    order.push(type);
  }

  const requiredSet = new Set(required);
  return order.map((type) => {
    const forType = documents.filter((document) => document.type === type);
    return {
      type,
      required: requiredSet.has(type),
      documents: forType,
      status: statusOf(forType),
    };
  });
}

function statusOf(documents: readonly ChecklistDocument[]): ChecklistItemStatus {
  if (documents.length === 0) return 'missing';
  if (documents.some((document) => document.verification === 'verified')) return 'verified';
  if (documents.some((document) => document.verification === 'pending')) return 'awaiting_review';
  return 'rejected';
}

/**
 * Whether every REQUIRED line has been verified.
 *
 * The question a landlord's decision screen asks, and it is deliberately strict:
 * an unread upload does not count, so "ready to decide" cannot be reached by an
 * applicant alone. Volunteered documents are ignored — they were not asked for,
 * so they cannot hold the decision up either.
 *
 * `true` for an application with no requirements at all, because there is
 * nothing outstanding; a screen that reads this must not render that as praise.
 */
export function everyRequirementVerified(items: readonly ChecklistItem[]): boolean {
  return items.every((item) => !item.required || item.status === 'verified');
}
