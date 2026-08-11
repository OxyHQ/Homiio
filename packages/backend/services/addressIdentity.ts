/**
 * The LEVEL-AWARE address identity key — ADR 0001 §3.1 and §5.1.
 *
 * This module is deliberately PURE: no database, no network, no imports from
 * the service that uses it. Everything here is a function of its arguments, so
 * a fixture can exercise it directly and the key it produces cannot depend on
 * which row happened to be written first — which is precisely the defect it
 * replaces.
 *
 * ## What is wrong with the v1 key, in one paragraph
 *
 * `computeAddressNormalizedKey` (`addressService.ts`) hashes
 * `street | number | unit | building_name | block | postal_code | city_id |
 * country_code`. `addresses.address_level` — a `GENERATED ALWAYS` column —
 * derives from `floor`, `unit`, `subunit`, `number`, `building_name`, `block`
 * and `entrance`. **`floor`, `entrance` and `subunit` decide the LEVEL and are
 * absent from the KEY**, so a building, the flat on its third floor, the flat on
 * its fourth, and its entrance B all hash identically and collapse onto one row
 * under `addresses_normalized_key_key`. ADR 0001 §1.3 measured it end to end:
 * three distinct rows out of six inputs, and the surviving row's LEVEL depends
 * on which advertisement was ingested first.
 *
 * Two flats then share one identity, the second household's reviews are
 * published under the first one's floor label, and one person who lived in 3r
 * and later in 4t can file exactly one review for both.
 *
 * ## Three changes, each with the case that forced it
 *
 * 1. **The level is hashed.** A BUILDING and a UNIT are two keys even when every
 *    other field agrees, so no projection can be mistaken for its child.
 * 2. **Positions are FIXED — absent fields contribute an empty slot rather than
 *    being dropped.** v1 ends with `.filter(Boolean)`, so `['a', '', 'b']` and
 *    `['a', 'b']` join to the same string: a building named `42` with no block
 *    and a building with no number in a block named `42` hash identically.
 * 3. **Internal whitespace is collapsed and diacritics are stripped.** v1 already
 *    lowercases and trims, so `Torre Mapfre`, `torre mapfre` and `Torre Mapfre `
 *    are one key today — but `Torre  Mapfre` (two spaces) is a SECOND building
 *    (ADR 0001 §1.3, measured). The v1 key is simultaneously too coarse and too
 *    fine, and this is the too-fine half.
 *
 * Normalization stops there on purpose. `Torre Mapfre I` and `Torre Mapfre II`
 * are two real buildings in one development, so nothing here strips numerals,
 * expands abbreviations or folds `c/` into `carrer`; a normalizer aggressive
 * enough to merge those would be trading a split for a much worse merge.
 *
 * ## The version is IN the hash
 *
 * `ADDRESS_NORMALIZATION_VERSION` prefixes every digest, so a future
 * normalization change produces a visibly different key rather than silently
 * re-keying rows written under the old rules. It is also the value written to
 * `address_candidates.normalization_version` and copied onto
 * `address_materializations`, which is what lets an audit tell a genuine
 * disagreement between two observations from a change in the rules between them.
 */

import * as crypto from 'crypto';
import { ADDRESS_LEVELS } from '../db/schema/addresses';

export type AddressLevel = (typeof ADDRESS_LEVELS)[number];

/**
 * The generation of the normalization + key rules below.
 *
 * Bump it in the same change that alters {@link normalizeIdentityValue},
 * {@link deriveAddressLevel} or {@link computeAddressIdentityKey}'s field order.
 * Never alter any of them without bumping it: the keys already stored would stop
 * matching and every place would be re-created on its next materialization.
 */
export const ADDRESS_NORMALIZATION_VERSION = 2;

/** The identity fields, per level, in the order they are hashed. */
export interface AddressIdentityFields {
  /** Required at every level. */
  readonly street: string;
  /** NULL when the source supplied none — never `''`, never `'00000'`. */
  readonly postalCode?: string | null;
  readonly cityId: string;
  readonly countryCode: string;
  // BUILDING adds these four.
  readonly number?: string | null;
  readonly buildingName?: string | null;
  readonly block?: string | null;
  readonly entrance?: string | null;
  // UNIT adds these three.
  readonly floor?: string | null;
  readonly unit?: string | null;
  readonly subunit?: string | null;
}

/**
 * Lowercase, strip diacritics, collapse internal whitespace, trim.
 *
 * Returns `''` for anything that normalizes away, which callers treat as
 * ABSENT — see {@link identityValueOrNull}, which is what the writer uses so
 * that no identity column ever holds an empty string.
 *
 * Diacritics are removed by decomposing to NFD and dropping the Combining
 * Diacritical Marks block, rather than by `\p{Diacritic}`: the block covers
 * every accent Homiio's Spanish, Catalan, Portuguese and Italian corpus
 * produces, and it avoids a Unicode property escape entirely.
 */
export function normalizeIdentityValue(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The normalized value, or NULL when it normalizes away.
 *
 * **Every write of an identity column goes through this**, and that is what
 * makes {@link deriveAddressLevel} agree with the `address_level` generated
 * column by CONSTRUCTION rather than by two implementations of one predicate
 * happening to match. The column's predicate is `coalesce(x, '') <> ''`, so a
 * stored `''` and a stored `'  '` differ: `''` reads as absent and `'  '` reads
 * as present and would promote a street to a building. If the writer never
 * stores either, the distinction cannot arise.
 *
 * It is also the `sparse`-unique rule `CONVENTIONS.md` states, applied one level
 * up: an empty string is a VALUE.
 */
export function identityValueOrNull(value: string | null | undefined): string | null {
  const normalized = normalizeIdentityValue(value);
  return normalized === '' ? null : normalized;
}

/**
 * STREET / BUILDING / UNIT, from the values as they will be STORED.
 *
 * A TypeScript copy of a `GENERATED ALWAYS` column's predicate, which is a
 * duplication worth naming rather than hiding: the level has to be known BEFORE
 * the insert (it is hashed into the key) and the database only answers after.
 * The copy is pinned by a test that inserts discriminating rows — including one
 * carrying `''`, written by raw SQL because the writer above cannot produce
 * one — and asserts this function and the column agree on every row. Without
 * that test the two could drift silently, and the symptom would be a key
 * claiming one level for a row the database labels another.
 */
export function deriveAddressLevel(fields: AddressIdentityFields): AddressLevel {
  const present = (value: string | null | undefined): boolean => (value ?? '') !== '';
  if (present(fields.floor) || present(fields.unit) || present(fields.subunit)) return 'UNIT';
  if (
    present(fields.number) ||
    present(fields.buildingName) ||
    present(fields.block) ||
    present(fields.entrance)
  ) {
    return 'BUILDING';
  }
  return 'STREET';
}

/**
 * The identity fields a row at `level` carries, with everything below that level
 * cleared.
 *
 * This is what makes a PROJECTION deterministic: the building above a flat is
 * the flat's fields minus `floor` / `unit` / `subunit`, so the building row a
 * unit resolves to is byte-for-byte the building row an independent
 * building-level candidate resolves to. `cityId` and `countryCode` are carried
 * at every level because geo is relational and a street is a street IN a city.
 */
export function projectIdentityFields(
  fields: AddressIdentityFields,
  level: AddressLevel,
): AddressIdentityFields {
  const street: AddressIdentityFields = {
    street: fields.street,
    postalCode: fields.postalCode ?? null,
    cityId: fields.cityId,
    countryCode: fields.countryCode,
  };
  if (level === 'STREET') return street;

  const building: AddressIdentityFields = {
    ...street,
    number: fields.number ?? null,
    buildingName: fields.buildingName ?? null,
    block: fields.block ?? null,
    entrance: fields.entrance ?? null,
  };
  if (level === 'BUILDING') return building;

  return {
    ...building,
    floor: fields.floor ?? null,
    unit: fields.unit ?? null,
    subunit: fields.subunit ?? null,
  };
}

/**
 * The v2 identity key: sha256 over the version, the level and eleven
 * fixed-position fields.
 *
 * `cityId` and `countryCode` are NOT normalized as text — they are an id and an
 * ISO code, so they are used verbatim (the code upper-cased). Normalizing an id
 * would be meaningless and stripping a diacritic from it impossible.
 *
 * @param fields The identity fields, at the level being keyed.
 * @param level The level to key AT. Pass the derived level for the row itself;
 *   pass a higher level to key its projection.
 */
export function computeAddressIdentityKey(
  fields: AddressIdentityFields,
  level: AddressLevel,
): string {
  const projected = projectIdentityFields(fields, level);
  // Fixed positions, and nothing is filtered out. An absent field contributes an
  // empty slot so that `42` in `number` and `42` in `block` can never produce
  // the same digest — the v1 defect this replaces.
  const parts = [
    `v${ADDRESS_NORMALIZATION_VERSION}`,
    level,
    normalizeIdentityValue(projected.street),
    normalizeIdentityValue(projected.postalCode),
    projected.cityId,
    projected.countryCode.toUpperCase(),
    normalizeIdentityValue(projected.number),
    normalizeIdentityValue(projected.buildingName),
    normalizeIdentityValue(projected.block),
    normalizeIdentityValue(projected.entrance),
    normalizeIdentityValue(projected.floor),
    normalizeIdentityValue(projected.unit),
    normalizeIdentityValue(projected.subunit),
  ];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Whether two field sets name the same place at `level`.
 *
 * Used by the v1-key ADOPTION path, where an existing row was found by a key
 * that does not hash every discriminating field: matching the v1 key proves
 * only that the v1 SUBSET agrees, and adopting a row on that basis is exactly
 * how a building acquires a flat's identity. This compares every v2 identity
 * field, normalized, so adoption happens only when the two really are the same
 * place.
 */
export function identityFieldsEqual(
  left: AddressIdentityFields,
  right: AddressIdentityFields,
  level: AddressLevel,
): boolean {
  return computeAddressIdentityKey(left, level) === computeAddressIdentityKey(right, level);
}
