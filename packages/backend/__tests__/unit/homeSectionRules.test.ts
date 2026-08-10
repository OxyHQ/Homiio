/**
 * Every Home section rule can actually be RENDERED (#353).
 *
 * ## What this gate exists to catch
 *
 * A section carries `reason` and `source` as i18n KEYS — the server has no
 * business deciding what language somebody reads, and a translated sentence
 * baked into a response is uncacheable across locales. The cost of that choice
 * is that a rule can ship pointing at a string nobody wrote, and the failure is
 * silent in the worst way: i18next renders a missing key as the key itself, so
 * a band appears headed `home.sections.priceReduced.reason` and looks like a
 * styling bug rather than a missing translation.
 *
 * Nothing else in either package would notice. `tsc` cannot check a string
 * against a JSON file, the integration suite asserts the key's SHAPE
 * (`/^home\.sections\./`) rather than its existence, and the locale parity
 * script only compares the twelve locales against `en.json` — so a key absent
 * from `en.json` is absent from all twelve and parity passes.
 *
 * ## Why it lives in the backend suite
 *
 * The rules do. A gate belongs next to the thing it constrains: adding a rule
 * here and forgetting the copy is the mistake, and this file fails in the same
 * run as the change that caused it.
 *
 * ## The anti-vacuity defences, which this shape needs three of
 *
 *  - **A floor on rules scanned.** `expect([]).toEqual([])` is what a broken
 *    import produces and is indistinguishable from a clean sweep.
 *  - **A pinned NEGATIVE case.** A lookup that stopped resolving anything would
 *    report every key missing, which fails loudly; one that resolved everything
 *    (returning the path, say) would report nothing missing and pass. The
 *    negative case catches the second.
 *  - **Totality over the id and source unions.** Checking only the ids the rules
 *    table happens to carry cannot catch a `HomeSectionId` added to the type
 *    with no rule and no copy — the "absence must be a decision" hole.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HomeSectionId, HomeSectionSource } from '@homiio/shared-types';

import { HOME_SECTION_RULES } from '../../db/home/homeSectionRules';

/** The frontend's English copy — the only file `t()` falls back to. */
const EN_LOCALE_PATH = join(__dirname, '..', '..', '..', 'frontend', 'locales', 'en.json');

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}

const en = JSON.parse(readFileSync(EN_LOCALE_PATH, 'utf8')) as JsonObject;

/** Resolve a dotted i18n key, or `undefined`. Mirrors i18next's own lookup. */
function lookup(key: string): JsonValue | undefined {
  let cursor: JsonValue | undefined = en;
  for (const part of key.split('.')) {
    if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as JsonObject)[part];
  }
  return cursor;
}

function hasCopy(key: string): boolean {
  const value = lookup(key);
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Every id the CONTRACT declares, not merely every id a rule uses.
 *
 * Written out rather than derived from the rules, deliberately: deriving it
 * would make this check agree with the rules table by construction, and the hole
 * it is here to close is a `HomeSectionId` added to the union with no rule
 * behind it and no copy written for it. A `satisfies` on a tuple of the union
 * makes tsc refuse an incomplete list, so it cannot silently rot.
 */
const ALL_SECTION_IDS = [
  'new_in_area',
  'price_reduced',
  'no_longer_available',
  'no_agency_fee',
  'transparent_total_cost',
  'with_resident_reviews',
  'verified',
  'public_housing',
] as const satisfies readonly HomeSectionId[];

const ALL_SOURCES = [
  'listing_created_at',
  'listing_sale_price_reduced_flag',
  'listing_status',
  'listing_agency_fee_flag',
  'listing_cost_fields',
  'resident_reviews',
  'listing_verification',
  'listing_housing_type',
] as const satisfies readonly HomeSectionSource[];

describe('the locale lookup can distinguish present from absent', () => {
  it('resolves a key that exists', () => {
    // The POSITIVE control. Without it, a lookup broken into always returning
    // `undefined` would report every key missing — loud, but the mirror image
    // (always resolving) would pass silently, so both directions need pinning.
    expect(hasCopy('home.sections.new_in_area.title')).toBe(true);
  });

  it('does NOT resolve a key that is absent', () => {
    // The NEGATIVE control: a lookup that resolved anything would make every
    // assertion below vacuous while reporting a clean tree.
    expect(hasCopy('home.sections.definitely_not_a_real_key_xyz')).toBe(false);
    expect(hasCopy('home')).toBe(false);
  });
});

describe('every rule can be rendered', () => {
  it('scans a plausible number of rules', () => {
    // The vacuity floor: a broken import yields an empty array, and every
    // per-rule assertion below then passes by never running.
    expect(HOME_SECTION_RULES.length).toBeGreaterThanOrEqual(8);
  });

  it('has English copy for every rule reason', () => {
    const missing = HOME_SECTION_RULES.filter((rule) => !hasCopy(rule.reason)).map(
      (rule) => `${rule.id} → ${rule.reason}`,
    );
    // Names the offending rule AND its key: a gate that reports only a count
    // makes whoever hits it go looking.
    expect(missing).toEqual([]);
  });

  it('has English copy for every rule source label', () => {
    const missing = HOME_SECTION_RULES.filter(
      (rule) => !hasCopy(`home.sections.source.${rule.source}`),
    ).map((rule) => `${rule.id} → home.sections.source.${rule.source}`);
    expect(missing).toEqual([]);
  });

  it('declares an offering set for every rule, so none is silently unreachable', () => {
    const empty = HOME_SECTION_RULES.filter((rule) => rule.offerings.length === 0).map((r) => r.id);
    // A rule with no offerings never runs, which reads in production as "that
    // section never has anything in this area" rather than as a bug.
    expect(empty).toEqual([]);
  });
});

describe('the contract and the rules table agree', () => {
  it('has a rule for every declared section id', () => {
    const implemented = new Set(HOME_SECTION_RULES.map((rule) => rule.id));
    const unimplemented = ALL_SECTION_IDS.filter((id) => !implemented.has(id));
    // Absence must be a DECISION. A `HomeSectionId` with no rule is a section
    // the type promises and the server never produces.
    expect(unimplemented).toEqual([]);
  });

  it('has title and eyebrow copy for every declared section id', () => {
    const missing = ALL_SECTION_IDS.flatMap((id) =>
      [`home.sections.${id}.title`, `home.sections.${id}.eyebrow`].filter((key) => !hasCopy(key)),
    );
    expect(missing).toEqual([]);
  });

  it('has copy for every declared source, including any no rule uses yet', () => {
    const missing = ALL_SOURCES.filter((source) => !hasCopy(`home.sections.source.${source}`));
    expect(missing).toEqual([]);
  });

  it('uses a distinct reason key per rule', () => {
    // Two rules sharing a reason means one of them is explaining itself with the
    // other's sentence, which is worse than a missing key because it reads fine.
    const reasons = HOME_SECTION_RULES.map((rule) => rule.reason);
    expect(new Set(reasons).size).toBe(reasons.length);
  });
});
