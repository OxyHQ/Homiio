/**
 * The seam that makes this integration copyable.
 *
 * CrowdSource's side of the "don't design moderation around your own nouns"
 * problem is already solved: the Case Envelope knows nothing about a listing, a
 * review or a post, and `@oxyhq/crowdsource` composes one from a description of
 * the material. What is left for an application is a translation problem, and
 * this file is the whole of it:
 *
 *     "given one of MY nouns and its id, describe the material"
 *
 * Everything downstream — digests, resource ids, relations, principal bindings,
 * the binding proof, the policy version, privacy terms, the idempotency key, the
 * envelope itself — is composed by the SDK from that description and is
 * IDENTICAL for every application and every subject type. So adding a subject
 * type is one file implementing {@link ModerationSubjectProvider} plus one line
 * in the registry; nothing in the outbox, the delivery worker, the webhook
 * receiver, the decision worker or the enforcement service changes.
 *
 * Two rules keep it that way, and both are load-bearing rather than stylistic:
 *
 * 1. **A provider returns a DESCRIPTION, never an envelope.** The types below
 *    are the SDK's own input types, re-exported unchanged. A provider that built
 *    an envelope would have to invent resource ids and principal refs — and the
 *    dedup key that gives one incident one case is computed over exactly those,
 *    so two people reporting one listing would open two cases, two juries and
 *    two consequences. That fails in production with nothing failing in a test.
 * 2. **A provider is pure translation with reads.** It fetches its own object
 *    and returns. It does not decide whether to deliver, what the allegation is,
 *    or what happens to the report; those belong to callers that are shared.
 */

import type { ContextInput, ReportSubjectInput, ResourceInput } from '@oxyhq/crowdsource';

/**
 * The SDK's resource description, unchanged.
 *
 * A type alias so a provider imports the vocabulary from this seam rather than
 * from four places — but it IS the SDK's type, not a local restatement. A
 * resource type added to the contract becomes available to every provider the
 * moment the dependency is bumped.
 */
export type ModerationResource = ResourceInput;
export type ModerationContextResource = ContextInput;

/**
 * One reported object, described.
 *
 * `content` is required because a report with no material is a question a jury
 * cannot answer. An application that cannot produce the material for one of its
 * nouns should not register a provider for it — see the registry.
 */
export interface ModerationSubjectSnapshot {
  /** Identity, type and author of the reported object. */
  readonly subject: ReportSubjectInput;
  /** The reported material itself. A string is shorthand for plain text. */
  readonly content: string | ModerationResource;
  /** Media carried BY the subject. */
  readonly attachments?: readonly ModerationResource[];
  /**
   * Surrounding material a jury needs to judge fairly — where a listing is, what
   * a review is about. Context, not extra exposure: a reviewer's view stays at
   * the minimum that makes the question answerable.
   */
  readonly context?: readonly ModerationContextResource[];
  /**
   * Facts about the object that are not the material and not an allegation.
   *
   * Merged into the report's metadata bag by `EvidenceSnapshotService`. This is
   * where a provider says what it could NOT send — how many photos a listing
   * has, that it came from an external portal — so a jury can tell the
   * difference between "there was nothing else" and "there was more and you were
   * not given it", and answer `insufficient_context` for the right reason.
   *
   * Scalars only, and nothing derived from a classifier may be phrased as a
   * finding here.
   */
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Translates one of Homiio's nouns into universal material.
 *
 * `subjectType` is declared on the provider rather than returned per snapshot
 * because it is a property of the noun: every Homiio listing is a
 * `commerce.listing`, every address review a `commerce.review`. Keeping it here
 * means the registry can answer "what does this application report?" without
 * loading a single object.
 */
export interface ModerationSubjectProvider {
  /** Homiio's own name for the noun, as it arrives on a report. */
  readonly reportedType: string;
  /** The namespaced universal subject type, or `custom.<org>.<object_type>`. */
  readonly subjectType: string;
  /**
   * Describes the object, or returns `null` when it no longer exists.
   *
   * `null` is not a failure. Content deleted between the report and its delivery
   * is ordinary, and it is the caller's job to decide what that means — a
   * provider that threw would make deletion look like an outage and be retried
   * for days.
   */
  snapshot(reportedId: string): Promise<ModerationSubjectSnapshot | null>;
}
