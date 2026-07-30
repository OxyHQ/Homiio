/**
 * Every noun Homiio can send for review, and the universal type each one is.
 *
 * Adding a subject type is one entry here plus one provider file. Nothing else
 * in the integration knows what a listing is — not the outbox, not the delivery
 * worker, not the webhook receiver, not the enforcement service.
 *
 * ## This list decides DELIVERY, and nothing else
 *
 * A reported type with a provider here is sent to CrowdSource. A reported type
 * WITHOUT one is still accepted by every report endpoint and still stored — it
 * simply never leaves. The registry is not an admission gate on the API, and
 * making it one means an application breaks its own existing report surfaces on
 * the day it adopts CrowdSource. Incremental adoption, one subject type at a
 * time, is the property that makes this integration copyable at all.
 *
 * ## Why an eviction case has no provider
 *
 * Homiio has a live "report this eviction notice" button backed by
 * `EvictionReport`, and it is deliberately not wired to a provider. An eviction
 * notice on the solidarity board is a claim about a legal process affecting a
 * named household — the material a jury would be handed is somebody's housing
 * situation, published by a third party who is not the subject. Deciding what a
 * randomly drawn jury should be shown in that case is a policy question with
 * real consequences for the household, and it has not been answered. Until it
 * is, those reports stay local: stored, counted by the reconciliation sweep, and
 * honestly not reviewed.
 *
 * ## Why there is no landlord, profile or agency provider
 *
 * Not an oversight and not for want of a document. Homiio has an `Agency`
 * collection and a `Profile` sidecar, but **no report surface for either** — no
 * route, no reason code, no button. A provider for a noun nothing can report
 * would be a snapshot function nothing ever calls, and its first real caller
 * would arrive with a reason vocabulary this file guessed at. `Agency` is the
 * obvious next provider on the day a surface exists; identity itself belongs to
 * Oxy, not to Homiio.
 */

import { ModerationReportedType } from '@homiio/shared-types';
import { createPropertySubjectProvider } from './propertySubject';
import { createReviewSubjectProvider } from './reviewSubject';
import type { ModerationSubjectProvider } from './types';

const PROVIDERS: readonly ModerationSubjectProvider[] = Object.freeze([
  createPropertySubjectProvider({ reportedType: ModerationReportedType.PROPERTY }),
  createReviewSubjectProvider({ reportedType: ModerationReportedType.REVIEW }),
]);

const BY_REPORTED_TYPE: ReadonlyMap<string, ModerationSubjectProvider> = new Map(
  PROVIDERS.map((provider) => [provider.reportedType, provider]),
);

/**
 * The provider for a reported type, or `undefined` when it is not deliverable.
 *
 * The single authority on whether a report leaves this deployment.
 * `ReportIntakeService` asks before queueing a delivery and
 * `EvidenceSnapshotService` asks again when it builds one; a type this returns
 * `undefined` for is stored and never enqueued.
 */
export function subjectProviderFor(
  reportedType: string,
): ModerationSubjectProvider | undefined {
  return BY_REPORTED_TYPE.get(reportedType);
}

/**
 * The reported types wired to CrowdSource, as the registry itself sees them.
 *
 * Exists so a test can pin the set. That is not ceremony: the difference between
 * a delivered type and a local-only one is invisible in a 201, so registering a
 * provider — or forgetting to — is a change no response body would reveal.
 * Pinning it makes widening the delivered surface a deliberate act with an
 * argument attached.
 */
export function deliverableTypes(): string[] {
  return Array.from(BY_REPORTED_TYPE.keys());
}
