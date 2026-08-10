/**
 * `generatePaymentSchedule` — the instalments a lease is billed in.
 *
 * Ported from `LeaseSchema.methods.generatePaymentSchedule`, a Mongoose METHOD
 * with no Postgres counterpart, so it becomes an ordinary pure function that
 * returns rows for `lease_payment_schedule`. It is a separate module from the
 * repository because it is the one piece of real arithmetic in the lease domain
 * and it earns its own test: this is the PRICED quantity a tenant agreed to, and
 * a wrong instalment is money.
 *
 * ## One hazard is ported verbatim; the other is FIXED, and the difference matters
 *
 * `leases` is empty in production, so there is no stored schedule to preserve.
 * That is what makes correcting a defect available here at all — but it is not a
 * licence to redesign, so exactly one thing changed and it is the one that made
 * the output depend on the machine rather than on the lease.
 *
 * **1. Month-end rollover — PORTED AS IT WAS.** `new Date(y, m, 31)` for a
 * 30-day month rolls FORWARD (31 April becomes 1 May), and `setMonth(+1)` from
 * 31 January lands on 2 or 3 March. So a lease with `rentDetailsDueDate = 31`
 * does not bill on the last day of each month — it drifts. That is a billing
 * POLICY question ("what does the 31st mean in February?"), the answer is not
 * obvious, and `leases_rent_due_date_check` bounds the day to 1-31 while saying
 * nothing about it. Changing it is the product's call, so it is left alone and
 * written down here instead.
 *
 * **2. Local-vs-UTC construction — FIXED.** The source built the cursor with
 * `new Date(y, m, d)`, which constructs in the SERVER's LOCAL zone, and then
 * compared it against `leaseTermsStartDate`, a `timestamptz` read back as an
 * absolute instant. So both the instalment COUNT and every DUE DATE moved with
 * the process's `TZ`. Measured, on this exact term
 * (2026-01-01 → 2026-12-31, due day 1):
 *
 * | `TZ` | rent instalments | first due date |
 * |---|--:|---|
 * | `UTC` | 12 | `2026-01-01T00:00:00Z` |
 * | `America/New_York` | 12 | `2026-01-01T05:00:00Z` |
 * | `Europe/Madrid` | **11** | `2026-01-31T23:00:00Z` |
 * | `Asia/Tokyo` | **11** | `2026-01-31T15:00:00Z` |
 *
 * Every zone east of UTC silently drops the tenant's FIRST month, because the
 * local-midnight cursor lands before the term starts and the loop skips a month
 * to compensate. This is the priced quantity — `subtotal` is what the tenant
 * agreed to — so a schedule that depends on which region a task happens to run
 * in is not a behaviour worth carrying into an empty table. `Date.UTC` makes the
 * cursor absolute, which reproduces the UTC column above exactly: production
 * runs UTC, so this changes nothing about what production would have generated
 * and removes the way it could have been wrong.
 *
 * ## What the CHECK now enforces that Mongo did not
 *
 * Every row this returns is `pending` with no `paidDate` and no `paidAmount`,
 * which is the half of `lease_payment_schedule_paid_evidence_check` that says an
 * unpaid instalment carries no payment evidence. `recordPayment` writes the
 * other half.
 */

import type { leasePaymentSchedule } from '../schema';

/** A row to insert, minus the id and the lease it belongs to. */
export type GeneratedInstalment = Omit<
  typeof leasePaymentSchedule.$inferInsert,
  'id' | 'leaseId'
>;

/** The lease fields the schedule is derived from. */
export interface PaymentScheduleInput {
  readonly leaseTermsStartDate: Date;
  readonly leaseTermsEndDate: Date;
  readonly rentDetailsMonthlyRent: number;
  /** Day of the month rent falls due, 1-31. */
  readonly rentDetailsDueDate: number;
  readonly rentDetailsSecurityDeposit: number;
}

/**
 * The instalments for a lease, in due-date order.
 *
 * A security deposit due on the start date when there is one, then one `rent`
 * row per month from the first due day on or after the start date up to and
 * including the end date.
 *
 * @returns Rows ready for `lease_payment_schedule`, all `pending`. Empty when
 *   the term is inverted — which `leases_term_order_check` already refuses at
 *   the database, so it is unreachable through a lease that exists.
 */
export function generatePaymentSchedule(
  lease: PaymentScheduleInput,
): GeneratedInstalment[] {
  const startDate = new Date(lease.leaseTermsStartDate);
  const endDate = new Date(lease.leaseTermsEndDate);
  const schedule: GeneratedInstalment[] = [];

  if (lease.rentDetailsSecurityDeposit > 0) {
    schedule.push({
      dueDate: startDate,
      amount: lease.rentDetailsSecurityDeposit,
      type: 'deposit',
      description: 'Security Deposit',
      status: 'pending',
    });
  }

  // `dueDate ?? startDate.getDate()` in the source. The column is NOT NULL with
  // a default of 1, so the fallback is unreachable through a stored lease and
  // the parameter is required here rather than carrying a branch nothing takes.
  const dueDay = lease.rentDetailsDueDate;

  // `Date.UTC` + the `getUTC*` accessors throughout: see hazard 2 in the header.
  // The month-end rollover is preserved, because `Date.UTC(y, m, 31)` for a
  // 30-day month still rolls forward exactly as the local-time constructor did.
  const currentDate = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), dueDay),
  );
  if (currentDate < startDate) {
    currentDate.setUTCMonth(currentDate.getUTCMonth() + 1);
  }

  while (currentDate <= endDate) {
    schedule.push({
      dueDate: new Date(currentDate),
      amount: lease.rentDetailsMonthlyRent,
      type: 'rent',
      // `timeZone: 'UTC'` for the same reason the cursor is UTC: without it the
      // LABEL is formatted in the server's zone, so an instalment stored at
      // `2026-02-01T00:00:00Z` reads "January 2026" on a machine west of UTC —
      // a description that contradicts the date beside it.
      //
      // The `en-US` is deliberate and does NOT go through the shared date
      // formatter (issue #357): this string is PERSISTED on the payment row at
      // schedule-generation time, when no reader and therefore no locale exists
      // yet. Formatting it per-locale here would freeze one tenant's language
      // into a row every party to the lease reads. Localising it properly means
      // storing the month as data and rendering it at read time, which is a
      // schema change rather than a formatting one.
      description: `Monthly Rent - ${currentDate.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })}`,
      status: 'pending',
    });

    currentDate.setUTCMonth(currentDate.getUTCMonth() + 1);
  }

  return schedule;
}
