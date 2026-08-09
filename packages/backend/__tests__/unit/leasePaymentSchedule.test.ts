/**
 * `generatePaymentSchedule` — the instalments a lease is billed in.
 *
 * A unit test rather than an integration one: the function is pure, and what
 * needs pinning is arithmetic over dates rather than anything a database does.
 *
 * ## The case this file exists for
 *
 * The Mongoose original built its month cursor with `new Date(y, m, d)`, which
 * constructs in the process's LOCAL zone, and compared it against a
 * `timestamptz` read back as an absolute instant. Both the instalment COUNT and
 * every due date therefore moved with `TZ` — every zone east of UTC silently
 * dropped the tenant's first month. `db/leases/paymentSchedule.ts` records the
 * measurements; this file is what stops it coming back.
 *
 * `TZ` is re-read by V8 on assignment (`process.env.TZ = …` takes effect for
 * `Date` constructed afterwards), which is what lets the zone sweep below be a
 * real check rather than a decorative one — and the mutation note at the bottom
 * says how that was confirmed.
 */

import { generatePaymentSchedule } from '../../db/leases/paymentSchedule';

/** A full calendar year, due on the 1st, with a deposit. */
const YEAR_LEASE = {
  leaseTermsStartDate: new Date('2026-01-01T00:00:00.000Z'),
  leaseTermsEndDate: new Date('2026-12-31T00:00:00.000Z'),
  rentDetailsMonthlyRent: 1200,
  rentDetailsDueDate: 1,
  rentDetailsSecurityDeposit: 2400,
};

/** Run `body` with `TZ` set, restoring whatever was there before. */
function withTimeZone<T>(timeZone: string, body: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return body();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

describe('generatePaymentSchedule', () => {
  it('emits a deposit plus one rent instalment per month', () => {
    const schedule = generatePaymentSchedule(YEAR_LEASE);

    expect(schedule.filter((row) => row.type === 'deposit')).toHaveLength(1);
    expect(schedule.filter((row) => row.type === 'rent')).toHaveLength(12);
    expect(schedule[0]).toMatchObject({
      type: 'deposit',
      amount: 2400,
      description: 'Security Deposit',
      status: 'pending',
    });
  });

  it('bills the FIRST month of the term, not the second', () => {
    // The regression the UTC fix closes: an off-by-one-month here is a tenant
    // never billed for January, and it looked like a correct 11-row schedule.
    const rent = generatePaymentSchedule(YEAR_LEASE).filter((row) => row.type === 'rent');
    expect(rent[0].dueDate.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(rent[0].description).toBe('Monthly Rent - January 2026');
    expect(rent[11].dueDate.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(rent[11].description).toBe('Monthly Rent - December 2026');
  });

  it('produces the IDENTICAL schedule in every time zone', () => {
    // Both sides of UTC, including the two zones measured to lose a month under
    // the local-time construction (`Europe/Madrid`, `Asia/Tokyo`).
    const zones = ['UTC', 'Europe/Madrid', 'Asia/Tokyo', 'America/New_York', 'Pacific/Kiritimati'];
    const rendered = zones.map((zone) =>
      withTimeZone(zone, () =>
        generatePaymentSchedule(YEAR_LEASE).map((row) => ({
          type: row.type,
          amount: row.amount,
          description: row.description,
          dueDate: row.dueDate.toISOString(),
        })),
      ),
    );

    for (const schedule of rendered) {
      expect(schedule).toEqual(rendered[0]);
    }
    // A vacuity floor: if the sweep ever compared empty arrays it would pass
    // while checking nothing.
    expect(rendered[0]).toHaveLength(13);
  });

  it('omits the deposit row when there is no security deposit', () => {
    const schedule = generatePaymentSchedule({ ...YEAR_LEASE, rentDetailsSecurityDeposit: 0 });
    expect(schedule.every((row) => row.type === 'rent')).toBe(true);
    expect(schedule).toHaveLength(12);
  });

  it('starts at the first due day ON OR AFTER the term start', () => {
    // Term starts on the 15th, rent falls due on the 1st: the first instalment
    // is the NEXT month's, because the 1st of the starting month precedes the
    // term.
    const rent = generatePaymentSchedule({
      ...YEAR_LEASE,
      leaseTermsStartDate: new Date('2026-01-15T00:00:00.000Z'),
      rentDetailsSecurityDeposit: 0,
    });
    expect(rent[0].dueDate.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(rent).toHaveLength(11);
  });

  it('rolls a 31st due day FORWARD in short months, as the source did', () => {
    // Deliberately preserved rather than fixed — it is a billing POLICY question
    // ("what does the 31st mean in February?") and `db/leases/paymentSchedule.ts`
    // explains why this port does not answer it. Pinned so that answering it
    // later is a decision somebody takes, not a diff nobody noticed.
    const rent = generatePaymentSchedule({
      ...YEAR_LEASE,
      leaseTermsStartDate: new Date('2026-01-01T00:00:00.000Z'),
      leaseTermsEndDate: new Date('2026-04-30T00:00:00.000Z'),
      rentDetailsDueDate: 31,
      rentDetailsSecurityDeposit: 0,
    });
    const dueDates = rent.map((row) => row.dueDate.toISOString());
    expect(dueDates[0]).toBe('2026-01-31T00:00:00.000Z');
    // January 31 + one month is March 3, not February 28 — the drift.
    expect(dueDates[1]).toBe('2026-03-03T00:00:00.000Z');
  });

  it('returns no rent rows for an inverted term', () => {
    // Unreachable through a stored lease (`leases_term_order_check` refuses it),
    // so this pins that the function does not loop forever or throw on input the
    // database would have rejected first.
    const schedule = generatePaymentSchedule({
      ...YEAR_LEASE,
      leaseTermsStartDate: new Date('2026-12-31T00:00:00.000Z'),
      leaseTermsEndDate: new Date('2026-01-01T00:00:00.000Z'),
      rentDetailsSecurityDeposit: 0,
    });
    expect(schedule).toHaveLength(0);
  });
});
