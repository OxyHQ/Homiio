/**
 * Turning a stored report into the thing the SDK delivers.
 *
 * This is NOT a case-envelope builder, and the difference matters enough to
 * name: `@oxyhq/crowdsource` builds the Case Envelope and deliberately does not
 * export the function that does it. What this module produces is the SDK's
 * `ReportInput` — a description of the material — and the SDK derives the
 * envelope from it: resource ids, relations, digests, pseudonymous principal
 * refs, the identity binding proof, the pinned policy version, the privacy terms
 * and the idempotency key.
 *
 * That is not a technicality. Those derived values are exactly what the dedup
 * key is computed over, so an application that composed its own envelope would
 * be the reason two reporters about one listing opened two cases — and "one
 * penalty per incident" would fail in production with nothing failing in a test.
 *
 * So this module does three things and no more: ask the registry for a snapshot
 * of the reported object, translate the reporter's reason into an allegation,
 * and assemble both with the report's own identity.
 *
 * ## Nothing composed here may vary between two deliveries of the same report
 *
 * Ingress fingerprints the whole envelope to detect an external id reused with a
 * different body, so an invented timestamp, a random id or an unstably-ordered
 * list turns a legitimate outbox retry into a permanent 409 — silently, days
 * later, as a report stuck in a queue. Hence `submittedAt` is the report's own
 * `createdAt` and never `new Date()`, and every value below is a pure function
 * of stored state.
 */

import { createHash } from 'crypto';
import type { ReportInput } from '@oxyhq/crowdsource';
import { ModerationReportedType } from '@homiio/shared-types';
import type { ModerationReportRow } from '../../db/moderation/moderationReportRepository';
import { REPORT_TAXONOMY_VERSION, allegationForReport } from './reportTaxonomy';
import { subjectProviderFor } from './subjects/registry';
import type { ModerationSubjectSnapshot } from './subjects/types';

/** The contract bounds the reporter's free text; this stays inside it. */
const MAX_DETAILS_LENGTH = 2_000;

/**
 * The stored `reported_type`, as the enum the taxonomy is keyed by.
 *
 * `moderation_reports.reported_type` is a `text` column whose CHECK carries the
 * enum's VALUES, so drizzle types the row as the string union rather than as
 * {@link ModerationReportedType} — and TypeScript does not accept a bare
 * `'property'` where a string enum member is wanted.
 *
 * Written as an exhaustive record rather than an assertion, and that is the
 * point of it. `MODERATION_REPORTED_TYPES` and this enum are two declarations of
 * one closed set, so a fourth noun added to the schema must be answered here
 * too; a cast would keep compiling and hand the new noun to
 * `allegationForReport`, which reads the LISTING table for everything that is
 * not a review. The report would deliver a plausible allegation drawn from the
 * wrong vocabulary, with nothing failing anywhere.
 */
const REPORTED_TYPE_BY_STORED_VALUE: Readonly<
  Record<ModerationReportRow['reportedType'], ModerationReportedType>
> = {
  property: ModerationReportedType.PROPERTY,
  review: ModerationReportedType.REVIEW,
  eviction_case: ModerationReportedType.EVICTION_CASE,
};

/**
 * The material could not be described, because nothing can describe it.
 *
 * This is a DEFECT, not a state, and it should be unreachable: a report whose
 * type has no subject provider never gets a delivery event in the first place,
 * because intake decides that from the same registry this module reads. An event
 * that arrives here was created by something that bypassed `ReportIntakeService`
 * — or by a deployment where a provider was removed while its reports were
 * still in flight.
 *
 * `retryable: false` therefore dead-letters the outbox event so the
 * reconciliation sweep counts it and a human looks. The alternative — writing a
 * local state — would file a genuine defect in the one place that looks
 * identical to the deliberate local-only reports, where nothing would ever alert
 * on it.
 *
 * Separate from "the object is gone": a deleted listing is a fact about the
 * world and closes the report normally.
 */
export class ModerationSubjectUnsupportedError extends Error {
  readonly retryable = false;

  constructor(reportedType: string) {
    super(`No moderation subject provider is registered for '${reportedType}'.`);
    this.name = 'ModerationSubjectUnsupportedError';
  }
}

/**
 * SHA-256 of the snapshot, stored on the report.
 *
 * Taken over the described MATERIAL, not over the whole `ReportInput`: the
 * report id, the reporter and the allegation are properties of the report, and
 * including them would mean two people reporting identical content produced
 * different hashes — the opposite of what this hash is for. Key order is fixed
 * by the literal below rather than by `Object.keys`, so the digest is stable
 * across Node versions and across a refactor that reorders a field.
 */
export function snapshotHash(snapshot: ModerationSubjectSnapshot): string {
  const canonical = JSON.stringify({
    subject: {
      externalId: snapshot.subject.externalId,
      type: snapshot.subject.type,
      author: snapshot.subject.author?.oxyUserId ?? null,
    },
    content: snapshot.content,
    attachments: snapshot.attachments ?? [],
    context: snapshot.context ?? [],
  });
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

export interface ModerationReportInput {
  /** What the SDK delivers. */
  readonly reportInput: ReportInput;
  /** The digest to store on the local report. */
  readonly snapshotHash: string;
}

/**
 * Describe a stored report for delivery, or report why it cannot be described.
 *
 * Returns `null` when the reported object no longer exists. That is not an error
 * either: content deleted between the report and its delivery is ordinary, and
 * an object Homiio never got to snapshot has no evidence to keep.
 */
export async function buildModerationReportInput(
  report: Pick<
    ModerationReportRow,
    'id' | 'reportedType' | 'reportedId' | 'reporterOxyUserId' | 'reason' | 'details' | 'createdAt'
  >,
): Promise<ModerationReportInput | null> {
  const provider = subjectProviderFor(report.reportedType);
  if (!provider) throw new ModerationSubjectUnsupportedError(report.reportedType);

  const snapshot = await provider.snapshot(report.reportedId);
  if (!snapshot) return null;

  const code = allegationForReport({
    reportedType: REPORTED_TYPE_BY_STORED_VALUE[report.reportedType],
    reason: report.reason,
  });
  const details = report.details?.trim();

  return {
    reportInput: {
      externalReportId: report.id,
      subject: snapshot.subject,
      content: snapshot.content,
      ...(snapshot.attachments === undefined
        ? {}
        : { attachments: snapshot.attachments }),
      ...(snapshot.context === undefined ? {} : { context: snapshot.context }),
      /**
       * One reason per report, so one allegation. The reporter's own words ride
       * on it — and they are the reporter's CLAIM, never evidence for it.
       */
      allegations: [
        details ? { code, details: details.slice(0, MAX_DETAILS_LENGTH) } : { code },
      ],
      /**
       * The Oxy subject IS the binding proof. Homiio stores reporters as Oxy
       * user ids resolved from the session, so there is no separate binding step
       * to implement here — and nothing a client could supply to fake one. The
       * column now says so in its own name (`reporter_oxy_user_id`), which is
       * what brings it inside the schema's Oxy-account classification rather
       * than leaving a `reporter` that could hold anything.
       */
      reportedBy: { oxyUserId: report.reporterOxyUserId },
      /**
       * The moment the USER reported it — the local report's own timestamp, not
       * the moment of delivery. Any value invented per attempt would make every
       * retry from the outbox a permanent 409.
       */
      submittedAt: report.createdAt,
      metadata: {
        /** So a case can be read back against the mapping that produced it. */
        homiioTaxonomyVersion: REPORT_TAXONOMY_VERSION,
        homiioReportReason: report.reason,
        /**
         * Declared, because it cannot be attached: Homiio listing photos live in
         * Homiio's own S3 with no Oxy file id and no stored digest, and the
         * contract's `AssetRef` requires both. A jury that can see material
         * exists which it was not given can answer `insufficient_context` for
         * the right reason instead of by accident.
         */
        evidenceAttachmentsSupported: false,
        ...(snapshot.metadata ?? {}),
      },
    },
    snapshotHash: snapshotHash(snapshot),
  };
}
