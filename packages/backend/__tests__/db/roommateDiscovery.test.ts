/**
 * The roommate candidate search, against a REAL Postgres server.
 *
 * This file exists because THREE of the filters it covers matched nothing at
 * all in Mongo, and the failure was invisible from the code: the selectors named
 * `personalProfile.gender`, `personalProfile.location` and
 * `personalProfile.dateOfBirth`, `personalProfileSchema` declares none of them,
 * and `database/connection.ts` sets `strictQuery: false` — so mongoose passed
 * them through rather than stripping them, and MongoDB matched no document.
 * Nothing errored. `?gender=`, `?location=` and `?ageRange=` simply returned an
 * empty page, always.
 *
 * A port that carried those selectors verbatim would answer zero just as
 * reliably in Postgres and LOOK finished, so each one is re-pointed at a fact
 * this product really stores. That makes every case below a behaviour change,
 * and a test is the only place a behaviour change can be pinned rather than
 * described.
 *
 * ## Every fixture sits on the side of the distinction its case exists to make
 *
 * `db/MIGRATION-CONTRACT.md` names the failure mode: the tidiest fixture is
 * usually the one that makes a check vacuous, and a green run cannot tell the
 * two apart. So, concretely —
 *
 *  - the gender cases seed `male`, `female`, `any` AND `NULL`, because a filter
 *    that did nothing would return all four;
 *  - the age-range cases seed a DISJOINT range and two that touch the query at
 *    exactly one endpoint, so `<=` versus `<` is visible;
 *  - the location cases seed a value differing only in CASE (a case-sensitive
 *    comparison passes every other case in the file) and one that a LIKE
 *    metacharacter would match if the term were not escaped;
 *  - the "unknown admits" cases seed a NULL beside every stated value, since
 *    `is null or …` and a bare comparison agree on every row that has an answer.
 *
 * Bounds are literal numbers rather than anything derived at run time: the
 * contract records a boundary test built from two independent `Date.now()`
 * calls that tested nothing about the boundary.
 */

import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxyhq/db';

import { closePostgres, connectPostgres, getDb, type Database } from '../../db/postgres';
import {
  searchRoommateCandidates,
  type RoommateCandidateQuery,
} from '../../db/profiles/profileRepository';
import { profilePreferredLocations, profileRoommateHistory, profiles } from '../../db/schema';

let db: Database;

/** The caller. Every query excludes them, so they never appear in a result. */
const CALLER = 'oxy-caller';

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

beforeEach(async () => {
  await getDb().delete(profiles);
  await getDb().insert(profiles).values({ oxyUserId: CALLER, settingsRoommateEnabled: true });
});

async function seedCandidate(
  oxyUserId: string,
  columns: Partial<typeof profiles.$inferInsert> = {},
): Promise<string> {
  const [row] = await getDb()
    .insert(profiles)
    .values({ oxyUserId, settingsRoommateEnabled: true, ...columns })
    .returning({ id: profiles.id });
  return row.id;
}

/** Run a search with the pagination defaults these cases do not care about. */
async function search(
  filters: Omit<RoommateCandidateQuery, 'excludeOxyUserId' | 'limit' | 'offset'> &
    Partial<Pick<RoommateCandidateQuery, 'limit' | 'offset'>>,
) {
  return searchRoommateCandidates(db, {
    excludeOxyUserId: CALLER,
    limit: 50,
    offset: 0,
    ...filters,
  });
}

/** The candidates a search returned, by Oxy account id, sorted for comparison. */
function matched(page: { candidates: readonly { profile: { oxyUserId: string } }[] }): string[] {
  return page.candidates.map((candidate) => candidate.profile.oxyUserId).sort();
}

describe('who is a candidate at all', () => {
  it('takes only profiles with matching ENABLED, and never the caller', async () => {
    await seedCandidate('oxy-on');
    await seedCandidate('oxy-off', { settingsRoommateEnabled: false });
    // NULL is a third state — the person never answered — and `= true` is what
    // keeps it out. `is not false` would let them in.
    await seedCandidate('oxy-never-asked', { settingsRoommateEnabled: null });

    const page = await search({});
    expect(matched(page)).toEqual(['oxy-on']);
    expect(page.total).toBe(1);
  });
});

describe('the GENDER filter — re-pointed at the stated roommate preference', () => {
  beforeEach(async () => {
    await seedCandidate('oxy-female', { settingsRoommatePreferencesGender: 'female' });
    await seedCandidate('oxy-male', { settingsRoommatePreferencesGender: 'male' });
    await seedCandidate('oxy-any', { settingsRoommatePreferencesGender: 'any' });
    await seedCandidate('oxy-unstated', { settingsRoommatePreferencesGender: null });
  });

  it('matches exactly the candidates who stated that preference', async () => {
    // Four fixtures, one match: a filter that was dropped would return four,
    // and one that also admitted `any` or NULL would return two or three.
    expect(matched(await search({ gender: 'female' }))).toEqual(['oxy-female']);
    expect(matched(await search({ gender: 'male' }))).toEqual(['oxy-male']);
  });

  it('is EXACT rather than "compatible with"', async () => {
    // `any` means "I do not mind", which is a different question from "who is
    // looking for a woman" — answering it here would make the filter mean
    // something nobody asked for and would be invisible without this case.
    expect(matched(await search({ gender: 'any' }))).toEqual(['oxy-any']);
  });

  it('returns everybody when no gender is asked for', async () => {
    expect(matched(await search({}))).toEqual([
      'oxy-any',
      'oxy-female',
      'oxy-male',
      'oxy-unstated',
    ]);
  });
});

describe('the AGE RANGE filter — an overlap, because no date of birth exists', () => {
  /**
   * Oxy owns identity and Homiio does not mirror it, so there is no date of
   * birth in either store and there must not be one. The stored fact is the
   * candidate's own preferred age range, and the question becomes "does their
   * range overlap the one you asked for" — a different question with the same
   * intent, and the only honest one available.
   */
  beforeEach(async () => {
    const range = (min: number | null, max: number | null) => ({
      settingsRoommatePreferencesAgeRangeMin: min,
      settingsRoommatePreferencesAgeRangeMax: max,
    });
    await seedCandidate('oxy-below', range(18, 24));
    await seedCandidate('oxy-touches-low', range(24, 30));
    await seedCandidate('oxy-inside', range(32, 35));
    await seedCandidate('oxy-touches-high', range(40, 50));
    await seedCandidate('oxy-above', range(41, 60));
    await seedCandidate('oxy-open', range(null, null));
    await seedCandidate('oxy-min-only', range(35, null));
    await seedCandidate('oxy-max-only', range(null, 20));
  });

  it('includes a range that touches the request at exactly one endpoint', async () => {
    // The bounds are CLOSED. `oxy-touches-low` ends at 30 and the request starts
    // at 30; `oxy-touches-high` starts at 40 and the request ends at 40. Turn
    // either comparison strict and both disappear — which is what makes this
    // the case that tells `>=` from `>`.
    const page = await search({ ageRange: { min: 30, max: 40 } });
    expect(matched(page)).toEqual([
      'oxy-inside',
      'oxy-min-only',
      'oxy-open',
      'oxy-touches-high',
      'oxy-touches-low',
    ]);
  });

  it('excludes a range that is strictly disjoint on either side', async () => {
    const page = await search({ ageRange: { min: 30, max: 40 } });
    expect(matched(page)).not.toContain('oxy-below');
    expect(matched(page)).not.toContain('oxy-above');
    expect(matched(page)).not.toContain('oxy-max-only');
  });

  it('admits an unstated bound, and answers a ONE-SIDED range on the side that was stated', async () => {
    // "Did not say" is not "does not match". The Mongo controller's own budget
    // filter established the rule — `if (typeof profileMax !== 'number') return
    // true` — and every predicate here follows it.
    //
    // The two halves are answered independently rather than through a single
    // "did they state a range" guard, which is what puts `oxy-min-only`
    // (`[35, …]`, so 90-99 really is inside what they asked for) beside
    // `oxy-open` here while `oxy-max-only` (`[…, 20]`) stays out of the 30-40
    // case above.
    expect(matched(await search({ ageRange: { min: 90, max: 99 } }))).toEqual([
      'oxy-min-only',
      'oxy-open',
    ]);
  });
});

describe('the LOCATION filter — a column that did not exist until migration 0008', () => {
  it('matches case-insensitively', async () => {
    // The stored value differs from the term only in CASE, so a case-sensitive
    // comparison fails here and passes everywhere else in this file.
    await seedCandidate('oxy-bcn', { settingsRoommatePreferencesLocation: 'Barcelona' });
    await seedCandidate('oxy-mad', { settingsRoommatePreferencesLocation: 'Madrid' });

    expect(matched(await search({ location: 'barcelona' }))).toEqual(['oxy-bcn']);
    expect(matched(await search({ location: 'BARCELONA' }))).toEqual(['oxy-bcn']);
  });

  it('matches on a substring, the way the regex filter did', async () => {
    await seedCandidate('oxy-gracia', {
      settingsRoommatePreferencesLocation: 'Barcelona, Gràcia',
    });
    expect(matched(await search({ location: 'Gràcia' }))).toEqual(['oxy-gracia']);
  });

  it('treats a LIKE metacharacter in the term as a literal', async () => {
    // `_` matches any single character in a LIKE pattern and means nothing in a
    // regex, so porting `{ $regex }` to `ILIKE` without `escapeLikePattern`
    // would silently widen the filter. `S_nts` must not find `Sants`.
    await seedCandidate('oxy-sants', { settingsRoommatePreferencesLocation: 'Sants' });
    await seedCandidate('oxy-literal', { settingsRoommatePreferencesLocation: 'S_nts' });

    expect(matched(await search({ location: 'S_nts' }))).toEqual(['oxy-literal']);
    expect(matched(await search({ location: 'Sants' }))).toEqual(['oxy-sants']);
  });

  it('does not admit a candidate who stated no location', async () => {
    // The one place "unknown" does NOT admit, and deliberately: a text search
    // that returned everybody with no answer would drown the answers.
    await seedCandidate('oxy-silent', { settingsRoommatePreferencesLocation: null });
    await seedCandidate('oxy-bcn', { settingsRoommatePreferencesLocation: 'Barcelona' });
    expect(matched(await search({ location: 'Barcelona' }))).toEqual(['oxy-bcn']);
  });
});

describe('the three filters that already worked, moved from JavaScript into SQL', () => {
  /**
   * `maxBudget`, `withPets` and `nonSmoking` were applied to the page AFTER
   * `skip`/`limit` had cut it, so they returned short pages beside a `total`
   * that counted rows the page had just dropped. Their per-candidate meaning is
   * carried across unchanged, "unknown admits" included.
   */
  it('keeps a candidate whose stated ceiling reaches the asked-for budget', async () => {
    await seedCandidate('oxy-rich', { settingsRoommatePreferencesBudgetMax: 1500 });
    await seedCandidate('oxy-exact', { settingsRoommatePreferencesBudgetMax: 1200 });
    await seedCandidate('oxy-lower', { settingsRoommatePreferencesBudgetMax: 1000 });
    await seedCandidate('oxy-unstated', { settingsRoommatePreferencesBudgetMax: null });

    expect(matched(await search({ maxBudget: 1200 }))).toEqual([
      'oxy-exact',
      'oxy-rich',
      'oxy-unstated',
    ]);
  });

  it('keeps pet-friendly and unstated candidates, and drops the refusals', async () => {
    await seedCandidate('oxy-yes', { settingsRoommatePreferencesLifestylePets: 'yes' });
    await seedCandidate('oxy-no', { settingsRoommatePreferencesLifestylePets: 'no' });
    await seedCandidate('oxy-prefer-not', {
      settingsRoommatePreferencesLifestylePets: 'prefer_not',
    });
    await seedCandidate('oxy-unstated', { settingsRoommatePreferencesLifestylePets: null });

    // `prefer_not` is a real ANSWER — "I would rather not say" — and is not the
    // same as never having been asked, which is what NULL means.
    expect(matched(await search({ withPets: true }))).toEqual(['oxy-unstated', 'oxy-yes']);
  });

  it('keeps non-smokers and unstated candidates', async () => {
    await seedCandidate('oxy-no', { settingsRoommatePreferencesLifestyleSmoking: 'no' });
    await seedCandidate('oxy-yes', { settingsRoommatePreferencesLifestyleSmoking: 'yes' });
    await seedCandidate('oxy-unstated', { settingsRoommatePreferencesLifestyleSmoking: null });

    expect(matched(await search({ nonSmoking: true }))).toEqual(['oxy-no', 'oxy-unstated']);
  });

  it('counts the filtered set rather than the whole table', async () => {
    await seedCandidate('oxy-yes', { settingsRoommatePreferencesLifestyleSmoking: 'yes' });
    await seedCandidate('oxy-no-1', { settingsRoommatePreferencesLifestyleSmoking: 'no' });
    await seedCandidate('oxy-no-2', { settingsRoommatePreferencesLifestyleSmoking: 'no' });

    const page = await search({ nonSmoking: true, limit: 1 });
    // ONE row on the page and TWO in the count: the page is cut, the count is
    // not, and both see the same predicate.
    expect(page.candidates).toHaveLength(1);
    expect(page.total).toBe(2);
  });
});

describe('paging and ordering', () => {
  it('walks a stable order across pages, newest first', async () => {
    // Written with explicit, distinct `updated_at` values rather than by
    // inserting quickly and hoping: rows written in one statement can share a
    // millisecond, and an ordering test that cannot distinguish two rows tests
    // nothing.
    const stamp = (iso: string) => ({ updatedAt: new Date(iso) });
    await seedCandidate('oxy-oldest', stamp('2026-01-01T00:00:00.000Z'));
    await seedCandidate('oxy-middle', stamp('2026-02-01T00:00:00.000Z'));
    await seedCandidate('oxy-newest', stamp('2026-03-01T00:00:00.000Z'));

    const first = await search({ limit: 2, offset: 0 });
    const second = await search({ limit: 2, offset: 2 });

    expect(first.candidates.map((candidate) => candidate.profile.oxyUserId)).toEqual([
      'oxy-newest',
      'oxy-middle',
    ]);
    expect(second.candidates.map((candidate) => candidate.profile.oxyUserId)).toEqual([
      'oxy-oldest',
    ]);
    expect(first.total).toBe(3);
  });
});

describe('hydration of a page', () => {
  it('gives each candidate ONLY its own child rows', async () => {
    // The page is hydrated with five statements for the whole set rather than
    // five per profile, so the grouping is the thing that can be wrong — and a
    // grouping that ignored `profile_id` would hand every candidate everybody
    // else's history. Two profiles with one distinguishable row each is the
    // smallest fixture that can see it.
    const first = await seedCandidate('oxy-first');
    const second = await seedCandidate('oxy-second');
    await getDb().insert(profilePreferredLocations).values([
      { profileId: first, city: 'Barcelona' },
      { profileId: second, city: 'Madrid' },
    ]);
    await getDb().insert(profileRoommateHistory).values([
      { profileId: first, startDate: new Date('2024-01-01T00:00:00.000Z'), location: 'Gràcia' },
      { profileId: second, startDate: new Date('2024-01-01T00:00:00.000Z'), location: 'Lavapiés' },
    ]);

    const page = await search({});
    const byOxyUserId = new Map(
      page.candidates.map((candidate) => [candidate.profile.oxyUserId, candidate]),
    );

    expect(byOxyUserId.get('oxy-first')?.preferredLocations.map((row) => row.city)).toEqual([
      'Barcelona',
    ]);
    expect(byOxyUserId.get('oxy-second')?.preferredLocations.map((row) => row.city)).toEqual([
      'Madrid',
    ]);
    expect(byOxyUserId.get('oxy-first')?.roommateHistory.map((row) => row.location)).toEqual([
      'Gràcia',
    ]);
    expect(byOxyUserId.get('oxy-second')?.roommateHistory.map((row) => row.location)).toEqual([
      'Lavapiés',
    ]);
  });

  it('gives a candidate with no child rows empty collections rather than nothing', async () => {
    await seedCandidate('oxy-bare');
    const [candidate] = (await search({})).candidates;
    expect(candidate.references).toEqual([]);
    expect(candidate.rentalHistory).toEqual([]);
    expect(candidate.preferredLocations).toEqual([]);
    expect(candidate.roommateHistory).toEqual([]);
    expect(candidate.chatHistory).toEqual([]);
  });

  it('never selects the protected income column', async () => {
    // `profileSelection()` excludes `personal_info_annual_income` at the TYPE
    // level, so this is a runtime confirmation that the search really goes
    // through it — a hand-written `select()` here would compile and leak.
    const id = await seedCandidate('oxy-rich', { personalInfoAnnualIncome: 48000 });
    const [stored] = await getDb().select().from(profiles).where(eq(profiles.id, id));
    expect(stored.personalInfoAnnualIncome).toBe(48000);

    const [candidate] = (await search({})).candidates;
    expect(Object.keys(candidate.profile)).not.toContain('personalInfoAnnualIncome');
    expect(JSON.stringify(candidate)).not.toContain('48000');
  });
});

describe('the two columns migration 0008 added', () => {
  it('stores and reads back an interests array', async () => {
    // Mongoose strict mode discarded every write of this field, so the column
    // holding a value at all is the fact under test.
    const id = await seedCandidate(`oxy-${uuidv7()}`, {
      settingsRoommatePreferencesInterests: ['climbing', 'cooking'],
      settingsRoommatePreferencesLocation: 'Barcelona',
    });

    const [stored] = await getDb().select().from(profiles).where(eq(profiles.id, id));
    expect(stored.settingsRoommatePreferencesInterests).toEqual(['climbing', 'cooking']);
    expect(stored.settingsRoommatePreferencesLocation).toBe('Barcelona');
  });

  it('keeps an empty array distinguishable from never having answered', async () => {
    const listed = await seedCandidate('oxy-none-listed', {
      settingsRoommatePreferencesInterests: [],
    });
    const silent = await seedCandidate('oxy-never-asked', {
      settingsRoommatePreferencesInterests: null,
    });

    const [listedRow] = await getDb().select().from(profiles).where(eq(profiles.id, listed));
    const [silentRow] = await getDb().select().from(profiles).where(eq(profiles.id, silent));
    expect(listedRow.settingsRoommatePreferencesInterests).toEqual([]);
    expect(silentRow.settingsRoommatePreferencesInterests).toBeNull();
  });
});
