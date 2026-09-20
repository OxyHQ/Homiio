/**
 * The two pure halves of real viewing availability (#518 §7.5):
 * the civil-time ↔ instant conversion, and the slot generator built on it.
 *
 * Both are pure, so every case here is measured against a real `Intl` with no
 * database and no clock — which is the only way the DST cases are checkable at
 * all, since the interesting days are months away from whenever this runs.
 *
 * `Europe/Madrid` is the anchor because it is Homiio's own market and because
 * its transitions are the ones the product will actually meet: CET (+1) and
 * CEST (+2), forward on the last Sunday of March, back on the last Sunday of
 * October.
 */

import {
  instantToZonedCivil,
  isSupportedTimeZone,
  zonedCivilToInstant,
  type ViewingWindow,
} from '@homiio/shared-types';

import { generateViewingSlots } from '../../db/availability/viewingWindows';

const MADRID = 'Europe/Madrid';

describe('zonedCivilToInstant — a civil time is not a moment until a zone says so', () => {
  it('anchors a winter time at +01:00 and a summer time at +02:00', () => {
    // The whole point: the SAME "10:00" is two different instants six months
    // apart, and neither of them is 10:00 UTC. A conversion that ignored the
    // zone would put both at 09:00Z and be wrong twice.
    expect(zonedCivilToInstant('2026-01-15', '10:00', MADRID)?.toISOString()).toBe(
      '2026-01-15T09:00:00.000Z',
    );
    expect(zonedCivilToInstant('2026-07-15', '10:00', MADRID)?.toISOString()).toBe(
      '2026-07-15T08:00:00.000Z',
    );
  });

  it('refuses a civil time the zone does not have — the spring-forward gap', () => {
    // 2026-03-29 in Madrid goes 01:59:59 CET → 03:00:00 CEST. No instant reads
    // 02:30 there, so there is no honest answer and `null` is it. Returning a
    // neighbouring moment would book an appointment for a time nobody chose,
    // and it would look completely normal in the database.
    expect(zonedCivilToInstant('2026-03-29', '02:30', MADRID)).toBeNull();
    // The times either side of the gap are ordinary and must still work, so
    // this is not a test that passes by rejecting everything.
    expect(zonedCivilToInstant('2026-03-29', '01:30', MADRID)?.toISOString()).toBe(
      '2026-03-29T00:30:00.000Z',
    );
    expect(zonedCivilToInstant('2026-03-29', '03:30', MADRID)?.toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
  });

  it('resolves an AMBIGUOUS autumn time to the later of its two instants', () => {
    // 2026-10-25 in Madrid goes 02:59:59 CEST → 02:00:00 CET, so 02:30 happens
    // twice: 00:30Z and 01:30Z. Both are real; the iteration converges on the
    // second, and this pins WHICH one rather than leaving it to be discovered
    // by an appointment an hour out.
    expect(zonedCivilToInstant('2026-10-25', '02:30', MADRID)?.toISOString()).toBe(
      '2026-10-25T01:30:00.000Z',
    );
  });

  it('round-trips through instantToZonedCivil in both seasons', () => {
    for (const date of ['2026-01-15', '2026-07-15']) {
      const instant = zonedCivilToInstant(date, '17:45', MADRID);
      expect(instant).not.toBeNull();
      const civil = instantToZonedCivil(instant as Date, MADRID);
      expect(civil?.date).toBe(date);
      expect(civil?.time).toBe('17:45');
      expect(civil?.minuteOfDay).toBe(17 * 60 + 45);
    }
  });

  it('reads weekday as 0 = Sunday, which is what the window table stores', () => {
    // 2026-03-01 is a Sunday. A window stores `extract(dow)`, so an off-by-one
    // here would offer every slot on the wrong day — and the list would still
    // look like a plausible schedule.
    expect(instantToZonedCivil(new Date('2026-03-01T12:00:00Z'), MADRID)?.weekday).toBe(0);
    expect(instantToZonedCivil(new Date('2026-03-02T12:00:00Z'), MADRID)?.weekday).toBe(1);
  });

  it('rejects malformed input rather than inventing a date', () => {
    expect(zonedCivilToInstant('2026-1-5', '10:00', MADRID)).toBeNull();
    expect(zonedCivilToInstant('2026-01-05', '25:00', MADRID)).toBeNull();
    expect(zonedCivilToInstant('2026-01-05', '10:00', 'Mars/Olympus')).toBeNull();
  });

  it('isSupportedTimeZone answers on the engine rather than on a list', () => {
    expect(isSupportedTimeZone(MADRID)).toBe(true);
    expect(isSupportedTimeZone('UTC')).toBe(true);
    expect(isSupportedTimeZone('Mars/Olympus')).toBe(false);
    expect(isSupportedTimeZone('')).toBe(false);
    expect(isSupportedTimeZone(undefined)).toBe(false);
  });
});

/** A window, with the boring fields filled in. */
function window(overrides: Partial<ViewingWindow> = {}): ViewingWindow {
  return {
    id: `w-${overrides.weekday ?? 2}-${overrides.startMinute ?? 1020}-${overrides.modality ?? 'in_person'}`,
    weekday: 2,
    startMinute: 17 * 60,
    endMinute: 19 * 60,
    slotMinutes: 30,
    modality: 'in_person',
    ...overrides,
  };
}

describe('generateViewingSlots', () => {
  // A Monday, 09:00 Madrid.
  const MONDAY = new Date('2026-06-01T07:00:00Z');

  it('carves a window into slots and offers nothing outside it', () => {
    const slots = generateViewingSlots({
      windows: [window()],
      timeZone: MADRID,
      now: MONDAY,
      days: 7,
      busy: [],
    });
    // Tuesday 2 June only — one Tuesday in the next 7 days from Monday.
    expect(slots.map((slot) => slot.time)).toEqual(['17:00', '17:30', '18:00', '18:30']);
    expect(slots.every((slot) => slot.date === '2026-06-02')).toBe(true);
    // 19:00 would end at 19:30, past the window. The generator asserts what it
    // PERMITS as well as what it refuses: the last slot is the one that fits.
    expect(slots.map((slot) => slot.time)).not.toContain('19:00');
  });

  it('offers nothing at all when the owner has published no window', () => {
    // The whole point of the feature: an empty schedule produces an empty list,
    // never the thirteen invented labels the screen used to draw.
    expect(
      generateViewingSlots({ windows: [], timeZone: MADRID, now: MONDAY, days: 14, busy: [] }),
    ).toEqual([]);
  });

  it('does not offer a slot an existing appointment overlaps — even partly', () => {
    // 17:15–17:45 sits across two published slots and takes both. A check that
    // compared start instants would leave 17:30 on offer and double-book it.
    const slots = generateViewingSlots({
      windows: [window()],
      timeZone: MADRID,
      now: MONDAY,
      days: 7,
      busy: [
        {
          start: new Date('2026-06-02T15:15:00Z'),
          end: new Date('2026-06-02T15:45:00Z'),
        },
      ],
    });
    expect(slots.map((slot) => slot.time)).toEqual(['18:00', '18:30']);
  });

  it('treats a back-to-back appointment as free, matching the half-open rule', () => {
    // 17:00–17:30 taken. 17:30 begins exactly as it ends, and `[)` says that is
    // not a conflict — the same convention `occupancy.ts` uses for nights.
    const slots = generateViewingSlots({
      windows: [window()],
      timeZone: MADRID,
      now: MONDAY,
      days: 7,
      busy: [
        {
          start: new Date('2026-06-02T15:00:00Z'),
          end: new Date('2026-06-02T15:30:00Z'),
        },
      ],
    });
    expect(slots.map((slot) => slot.time)).toEqual(['17:30', '18:00', '18:30']);
  });

  it('offers two modalities in the same hour when the owner declared both', () => {
    const slots = generateViewingSlots({
      windows: [
        window(),
        window({ modality: 'video', startMinute: 17 * 60, endMinute: 18 * 60 }),
      ],
      timeZone: MADRID,
      now: MONDAY,
      days: 7,
      busy: [],
    });
    expect(slots.filter((slot) => slot.time === '17:00').map((slot) => slot.modality)).toEqual([
      'in_person',
      'video',
    ]);
  });

  it('narrows to one modality when asked', () => {
    const slots = generateViewingSlots({
      windows: [window(), window({ modality: 'video' })],
      timeZone: MADRID,
      now: MONDAY,
      days: 7,
      busy: [],
      modality: 'video',
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((slot) => slot.modality === 'video')).toBe(true);
  });

  it('holds the wall-clock time across a DST transition', () => {
    // From the Wednesday before the spring-forward Sunday to the Tuesday after
    // it. An owner who published "Tuesdays at 17:00" means 17:00 on both sides,
    // which is 16:00Z before the change and 15:00Z after. A generator that
    // added 86,400,000 ms per day would drift by the hour and start offering
    // 16:00 — a plausible-looking list that nobody published.
    const slots = generateViewingSlots({
      windows: [window({ startMinute: 17 * 60, endMinute: 17 * 60 + 30 })],
      timeZone: MADRID,
      now: new Date('2026-03-25T08:00:00Z'),
      days: 14,
      busy: [],
    });
    expect(slots.map((slot) => `${slot.date} ${slot.time} ${slot.startsAt}`)).toEqual([
      '2026-03-31 17:00 2026-03-31T15:00:00.000Z',
      '2026-04-07 17:00 2026-04-07T15:00:00.000Z',
    ]);
  });

  it('skips a slot the spring-forward gap deletes, and keeps the rest of the day', () => {
    // A 02:00–04:00 window on the Sunday the clocks go forward. 02:00 and 02:30
    // do not exist in Madrid that morning; 03:00 and 03:30 do.
    const slots = generateViewingSlots({
      windows: [window({ weekday: 0, startMinute: 2 * 60, endMinute: 4 * 60 })],
      timeZone: MADRID,
      now: new Date('2026-03-28T08:00:00Z'),
      days: 2,
      busy: [],
    });
    expect(slots.map((slot) => slot.time)).toEqual(['03:00', '03:30']);
  });

  it('will not offer a slot inside the notice period', () => {
    // 09:00 Madrid, with a window that opened at 08:00 the same morning. 09:00
    // and 09:30 are inside the hour of notice; 10:00 is the first one offered.
    const slots = generateViewingSlots({
      windows: [window({ weekday: 1, startMinute: 8 * 60, endMinute: 11 * 60 })],
      timeZone: MADRID,
      now: MONDAY,
      days: 1,
      busy: [],
    });
    expect(slots.map((slot) => slot.time)).toEqual(['10:00', '10:30']);
  });

  it('answers for ONE civil day when the write path asks about one', () => {
    const slots = generateViewingSlots({
      windows: [window()],
      timeZone: MADRID,
      now: MONDAY,
      days: 14,
      busy: [],
      onlyDate: '2026-06-09',
    });
    expect(slots.length).toBe(4);
    expect(slots.every((slot) => slot.date === '2026-06-09')).toBe(true);
  });
});
