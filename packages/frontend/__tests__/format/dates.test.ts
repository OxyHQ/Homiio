/**
 * Tests for the shared date formatter (`format/dates`).
 *
 * Two of these fixtures are the whole point of the module, and both are written
 * so that the WRONG implementation is visibly wrong rather than merely
 * differently formatted:
 *
 *  - The civil-date case asserts the correct output AND demonstrates, in the
 *    same test, what `new Date('2026-03-29')` does in a western zone. Without
 *    that second assertion the case would pass against a naive implementation in
 *    any test runner whose TZ happens to be east of Greenwich, which is the
 *    "fixtures all sit on the same side of the distinction" trap.
 *  - The day-change case formats ONE instant in two zones and requires two
 *    different calendar days, which no zone-less implementation can produce.
 *
 * `Intl` output moves with ICU, so the assertions read the day/month/hour out of
 * the string rather than pinning it whole. See `money.test.ts` for the full
 * reasoning.
 */
import {
  deviceTimeZone,
  formatDate,
  formatDateRange,
  formatRelativeDate,
  isCivilDate,
} from '@homiio/shared-types';

describe('civil dates — a calendar day must not shift by timezone', () => {
  it('renders 2026-03-29 as the 29th even in a zone eight hours behind UTC', () => {
    const text = formatDate('2026-03-29', 'en-US', 'America/Los_Angeles');
    expect(text).toContain('29');
    expect(text).toContain('Mar');

    // The bug this exists to prevent, demonstrated rather than asserted about:
    // `new Date('2026-03-29')` is UTC MIDNIGHT, so Los Angeles reads the 28th.
    // If this ever stops being true the fixture has stopped discriminating.
    const naive = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      dateStyle: 'medium',
    }).format(new Date('2026-03-29'));
    expect(naive).toContain('28');
    expect(text).not.toBe(naive);
  });

  it('renders the same civil date identically in every zone', () => {
    const zones = ['UTC', 'America/Los_Angeles', 'Europe/Madrid', 'Asia/Tokyo', 'Pacific/Kiritimati'];
    const rendered = zones.map((zone) => formatDate('2026-01-01', 'en-US', zone));
    expect(new Set(rendered).size).toBe(1);
    expect(rendered[0]).toContain('2026');
    expect(rendered[0]).toContain('Jan');
    expect(rendered[0]).toContain('1');
  });

  it('recognises the civil shape and nothing else', () => {
    expect(isCivilDate('2026-03-29')).toBe(true);
    expect(isCivilDate('2026-03-29T10:00:00Z')).toBe(false);
    expect(isCivilDate('29/03/2026')).toBe(false);
    expect(isCivilDate(new Date())).toBe(false);
    expect(isCivilDate(undefined)).toBe(false);
  });
});

describe('instants — the zone genuinely decides the day, and must be named', () => {
  /** 23:30 UTC: still Sunday in New York, already Monday in Tokyo. */
  const instant = '2026-03-01T23:30:00Z';

  it('renders one instant as two different calendar days in two zones', () => {
    const newYork = formatDate(instant, 'en-US', 'America/New_York');
    const tokyo = formatDate(instant, 'en-US', 'Asia/Tokyo');
    expect(newYork).toContain('1');
    expect(newYork).toContain('Mar');
    expect(tokyo).toContain('2');
    expect(tokyo).toContain('Mar');
    expect(newYork).not.toBe(tokyo);
  });

  it('can show the zone name, so a shifted booking is not silent', () => {
    // Explicit component options rather than `dateStyle`/`timeStyle`: ECMA-402
    // forbids combining either of those with `timeZoneName`, and `Intl` answers
    // the combination with a TypeError rather than ignoring it.
    const text = formatDate(instant, 'en-US', 'Asia/Tokyo', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
    expect(text).toMatch(/GMT|UTC|JST/);
    expect(text).toContain('2');
  });

  it('handles the spring-forward DST boundary in Europe/Madrid', () => {
    // EU DST starts 2026-03-29 at 01:00 UTC: 01:59 CET becomes 03:00 CEST, so
    // local 02:00–02:59 does not exist that day.
    const before = formatDate('2026-03-29T00:30:00Z', 'en-GB', 'Europe/Madrid', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const after = formatDate('2026-03-29T01:30:00Z', 'en-GB', 'Europe/Madrid', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    expect(before).toContain('01:30');
    // One hour of wall clock later would be 02:30; the jump proves the offset
    // changed rather than the formatter simply adding an hour.
    expect(after).toContain('03:30');
    expect(after).not.toContain('02:30');
  });

  it('accepts a Date and an epoch millisecond value, not only a string', () => {
    const asDate = formatDate(new Date(instant), 'en-US', 'Asia/Tokyo');
    const asEpoch = formatDate(Date.parse(instant), 'en-US', 'Asia/Tokyo');
    expect(asDate).toBe(asEpoch);
  });

  it('returns an empty string for an unparseable value rather than "Invalid Date"', () => {
    expect(formatDate('not a date', 'en-US', 'UTC')).toBe('');
    expect(formatDate(Number.NaN, 'en-US', 'UTC')).toBe('');
  });

  it('does not throw on a malformed locale or an unknown zone', () => {
    expect(() => formatDate(instant, 'not a locale', 'UTC')).not.toThrow();
    expect(() => formatDate(instant, 'en-US', 'Mars/Olympus_Mons')).not.toThrow();
  });

  it('follows the locale for the field order', () => {
    const us = formatDate(instant, 'en-US', 'UTC', { dateStyle: 'short' });
    const es = formatDate(instant, 'es-ES', 'UTC', { dateStyle: 'short' });
    expect(us).not.toBe(es);
  });
});

describe('formatDateRange', () => {
  it('joins two civil dates without either end shifting', () => {
    const text = formatDateRange('2026-06-01', '2026-06-08', 'en-US', 'America/Los_Angeles');
    expect(text).toContain('1');
    expect(text).toContain('8');
    expect(text).toContain('Jun');
  });

  it('returns an empty string when either end is unparseable', () => {
    expect(formatDateRange('2026-06-01', 'nope', 'en-US', 'UTC')).toBe('');
    expect(formatDateRange('nope', '2026-06-08', 'en-US', 'UTC')).toBe('');
  });
});

describe('formatRelativeDate', () => {
  /** A fixed "now" so these never depend on when the suite runs. */
  const now = new Date('2026-06-10T12:00:00Z');

  it('gives a relative phrase inside the window', () => {
    const text = formatRelativeDate('2026-06-13T12:00:00Z', 'en-US', now, { timeZone: 'UTC' });
    expect(text).toContain('3');
    expect(text).toMatch(/day/);
  });

  it('gives it in the reader locale', () => {
    const text = formatRelativeDate('2026-06-08T12:00:00Z', 'es-ES', now, { timeZone: 'UTC' });
    expect(text).not.toMatch(/day/);
    expect(text.length).toBeGreaterThan(0);
  });

  it('picks the largest unit that fits', () => {
    expect(formatRelativeDate('2026-06-10T11:59:30Z', 'en-US', now, { timeZone: 'UTC' })).toMatch(
      /second/,
    );
    expect(formatRelativeDate('2026-06-10T11:30:00Z', 'en-US', now, { timeZone: 'UTC' })).toMatch(
      /minute/,
    );
    expect(formatRelativeDate('2026-06-10T09:00:00Z', 'en-US', now, { timeZone: 'UTC' })).toMatch(
      /hour/,
    );
  });

  it('falls back to the absolute date beyond the window', () => {
    const text = formatRelativeDate('2026-09-01T12:00:00Z', 'en-US', now, { timeZone: 'UTC' });
    expect(text).toContain('2026');
    expect(text).toContain('Sep');
    expect(text).not.toMatch(/in \d+ days/);
  });

  it('honours a caller-supplied window', () => {
    const text = formatRelativeDate('2026-06-12T12:00:00Z', 'en-US', now, {
      timeZone: 'UTC',
      absoluteAfterMs: 60 * 60 * 1000,
    });
    expect(text).toContain('Jun');
    expect(text).not.toMatch(/day/);
  });

  it('returns an empty string for an unparseable value', () => {
    expect(formatRelativeDate('not a date', 'en-US', now)).toBe('');
  });
});

describe('deviceTimeZone', () => {
  it('names a zone rather than returning an empty string', () => {
    expect(deviceTimeZone().length).toBeGreaterThan(0);
  });
});
