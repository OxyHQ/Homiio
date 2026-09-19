/**
 * Repair requests — the tenant's side of a tenancy going wrong (#518 §7.1,
 * #519 §7.1).
 *
 * ## Why this domain did not exist, and why its absence was not a gap in a screen
 *
 * `app/my-home.tsx` said so in its own header: "Homiio has no maintenance,
 * rent-payment or tenant–landlord messaging endpoint, so those are absent
 * rather than buttons that do nothing." Honest, and both epics reject it as an
 * ending: "«El backend no lo soporta, así que lo quitamos» no es un criterio de
 * finalización aceptable."
 *
 * The nearest thing that existed is `leases.inspections`, and it is a different
 * fact: a landlord's move-in, move-out or periodic WALKTHROUGH, scheduled by
 * the person who owns the building. A repair request is raised by whoever lives
 * there, about something that is already broken. Reusing the inspection rows
 * would have made "report a repair" write into a landlord's audit trail.
 *
 * ## The shape, and the two rules that shape it
 *
 * **A request belongs to a LEASE, not to a property.** A property outlives
 * every tenancy in it, and a repair somebody reported in 2019 is not the
 * business of whoever rents the flat today. The lease is also where the
 * participants already are — landlord, tenant and co-tenants — so authorization
 * needs no second list to drift out of step with the first.
 *
 * **Status moves along a declared path.** {@link MAINTENANCE_TRANSITIONS} is
 * the whole of it, and it is data rather than a switch so both sides can check
 * a move before offering it — a button that produces a 409 is a worse answer
 * than one that is not drawn.
 */

/**
 * What kind of thing is broken.
 *
 * A closed vocabulary rather than free text, because the category routes the
 * request and free text cannot be routed. Deliberately short: a list nobody can
 * scan is a list everybody answers "other" to.
 */
export const MAINTENANCE_CATEGORIES = [
  'plumbing',
  'electrical',
  'heating',
  'appliance',
  'structural',
  'pest',
  'security',
  'other',
] as const;

export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];

/**
 * How badly it needs fixing, as the REPORTER sees it.
 *
 * `emergency` is the reason this is not a free number: it is the one value that
 * should reach somebody immediately, and a scale of 1–5 makes "how urgent is
 * urgent" a per-person judgement nobody can act on. The word is the contract.
 *
 * It is never rewritten by the landlord. A disagreement about urgency belongs
 * in the thread, where it is visible, rather than in a field that quietly
 * changes what the tenant said.
 */
export const MAINTENANCE_URGENCIES = ['low', 'normal', 'high', 'emergency'] as const;

export type MaintenanceUrgency = (typeof MAINTENANCE_URGENCIES)[number];

/**
 * Where the request is in its life.
 *
 *  - `open` — reported, nobody has picked it up.
 *  - `acknowledged` — the landlord has seen it and owns it.
 *  - `scheduled` — a visit or a trade is arranged.
 *  - `resolved` — the landlord says it is fixed.
 *  - `closed` — the REPORTER agrees, or it was withdrawn. Terminal.
 *  - `declined` — the landlord refuses it, with a reason in the thread.
 *
 * `resolved` and `closed` are deliberately two states. "Fixed" is a claim by
 * the person who owes the repair, and the person living with it is the one who
 * can confirm it — a single terminal state would let one party end the other's
 * problem. Reopening is therefore possible from `resolved` and not from
 * `closed`.
 */
export const MAINTENANCE_STATUSES = [
  'open',
  'acknowledged',
  'scheduled',
  'resolved',
  'closed',
  'declined',
] as const;

export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

/** Which party a person is on a lease. Derived from the lease, never sent. */
export type MaintenanceRole = 'tenant' | 'landlord';

/**
 * Every legal move, as DATA.
 *
 * A table rather than a `switch` for three reasons that all matter at a
 * different layer: the client can decide which buttons exist without
 * reimplementing the rule, the server can refuse an illegal move without a
 * chain of `if`s that will grow a hole, and a test can enumerate the whole
 * space — which is the only way to assert that `closed` is terminal rather than
 * to hope nobody adds an edge out of it.
 *
 * The ROLE is part of the edge. A tenant cannot mark their own request
 * resolved, because "resolved" is a claim about work somebody else owes; a
 * landlord cannot close it, because closing is the reporter agreeing. Those two
 * asymmetries are the whole reason the table has a role column.
 */
export const MAINTENANCE_TRANSITIONS: readonly {
  readonly from: MaintenanceStatus;
  readonly to: MaintenanceStatus;
  readonly by: MaintenanceRole;
}[] = [
  // The landlord picks it up, schedules it, or refuses it.
  { from: 'open', to: 'acknowledged', by: 'landlord' },
  { from: 'open', to: 'declined', by: 'landlord' },
  { from: 'acknowledged', to: 'scheduled', by: 'landlord' },
  { from: 'acknowledged', to: 'resolved', by: 'landlord' },
  { from: 'acknowledged', to: 'declined', by: 'landlord' },
  { from: 'scheduled', to: 'resolved', by: 'landlord' },
  // The reporter agrees it is done, or says it is not.
  { from: 'resolved', to: 'closed', by: 'tenant' },
  { from: 'resolved', to: 'open', by: 'tenant' },
  // Either side can end a request that was declined; the tenant can withdraw
  // one nobody has picked up yet.
  { from: 'declined', to: 'closed', by: 'tenant' },
  { from: 'open', to: 'closed', by: 'tenant' },
];

/** Whether a role may move a request from one status to another. */
export function canTransitionMaintenance(
  from: MaintenanceStatus,
  to: MaintenanceStatus,
  by: MaintenanceRole,
): boolean {
  return MAINTENANCE_TRANSITIONS.some(
    (edge) => edge.from === from && edge.to === to && edge.by === by,
  );
}

/** Every status this role may move a request to from here. For drawing buttons. */
export function maintenanceTransitionsFrom(
  from: MaintenanceStatus,
  by: MaintenanceRole,
): MaintenanceStatus[] {
  return MAINTENANCE_TRANSITIONS.filter((edge) => edge.from === from && edge.by === by).map(
    (edge) => edge.to,
  );
}

/** Statuses from which nothing more can happen. Derived, never listed twice. */
export function isTerminalMaintenanceStatus(status: MaintenanceStatus): boolean {
  return !MAINTENANCE_TRANSITIONS.some((edge) => edge.from === status);
}

/** A comment on a request. Visible to every participant of the lease. */
export interface MaintenanceComment {
  readonly id: string;
  readonly oxyUserId: string;
  /** Which side of the lease the author is on, resolved server-side. */
  readonly role: MaintenanceRole;
  readonly body: string;
  readonly createdAt: string;
}

/**
 * One entry in the request's history.
 *
 * Recorded for every status change, so "who said it was fixed, and when" is a
 * fact rather than an inference from timestamps. `from` is absent on the
 * creation entry, which is the only one with no previous status.
 */
export interface MaintenanceEvent {
  readonly id: string;
  readonly oxyUserId: string;
  readonly role: MaintenanceRole;
  readonly from?: MaintenanceStatus;
  readonly to: MaintenanceStatus;
  readonly createdAt: string;
}

export interface MaintenanceRequest {
  readonly id: string;
  readonly leaseId: string;
  readonly propertyId: string;
  /** Who raised it. */
  readonly reportedByOxyUserId: string;
  readonly category: MaintenanceCategory;
  readonly urgency: MaintenanceUrgency;
  readonly status: MaintenanceStatus;
  readonly title: string;
  readonly description: string;
  /** When the landlord says a visit or a trade is arranged. */
  readonly scheduledFor?: string;
  readonly resolvedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Present on a single-request read; absent from a list. */
  readonly comments?: readonly MaintenanceComment[];
  readonly events?: readonly MaintenanceEvent[];
  /**
   * What the CALLER may do next, resolved from their own role and the current
   * status.
   *
   * Sent by the server rather than derived on the client, even though
   * {@link maintenanceTransitionsFrom} is shared and would give the same answer:
   * the client does not know which side of the lease it is on without asking,
   * and a screen that guessed would offer a landlord's buttons to a tenant. The
   * shared function is what the SERVER uses to compute this, so the two cannot
   * disagree.
   */
  readonly availableTransitions?: readonly MaintenanceStatus[];
}

/** The longest a title and a body may be. Enforced on the server. */
export const MAINTENANCE_TITLE_MAX = 120;
export const MAINTENANCE_DESCRIPTION_MAX = 4_000;
export const MAINTENANCE_COMMENT_MAX = 4_000;
