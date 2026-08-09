/**
 * Would Postgres accept this row? — asked BEFORE the first insert, of every row,
 * against the target's OWN column metadata.
 *
 * ## Why an audit exists at all
 *
 * `db/schema/CONVENTIONS.md` states the reason in one line: **Mongoose enums were
 * never enforced on an update.** `runValidators` is off for updates in this
 * package, so a live collection may hold values its own schema forbids — a
 * `currency` no `enum` list contains, a `population` stored as a string, a
 * required field a `$set` removed. Every one of those is accepted by Mongo and
 * refused by the target's CHECK, `NOT NULL` or type.
 *
 * A copy that discovers this by inserting fails HALF WAY: some rows are in, one
 * raised `23514`, and the operator has a driver error naming a single row rather
 * than an inventory of what is wrong. So the audit runs first, over every
 * candidate row, and reports EVERY violation it finds — grouped by column, with
 * counts and examples — so one pass tells you the whole story.
 *
 * ## Derived from the schema, never restated
 *
 * The rules below are read out of the drizzle table itself
 * (`getTableColumns` → `notNull`, `hasDefault`, `dataType`, `columnType`,
 * `enumValues`). Nothing here re-declares what a column accepts, so this cannot
 * drift from `db/schema/`: adding a currency to `LISTING_CURRENCIES` widens the
 * CHECK and this audit in the same edit, and narrowing a column tightens both.
 *
 * A restated copy of the rules would be a second schema, and a second schema
 * that disagrees with the first is worse than no audit — it reports green on
 * exactly the values the database is about to reject.
 *
 * What is NOT derivable is the handful of TABLE-level CHECKs (an all-or-none
 * group, a two-column ordering) and the foreign keys, whose satisfaction depends
 * on rows in another table. Those are passed in as named {@link RowRule}s by the
 * caller that owns them.
 */

import { getTableColumns } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

/**
 * A candidate row, before it is known to fit its target.
 *
 * Deliberately loose: the mappers preserve whatever the source document held so
 * that a wrong SHAPE reaches the audit and is reported, rather than being
 * coerced to `null` on the way and disappearing into a nullable column. The
 * narrowing to a table's `$inferInsert` type happens only after this module has
 * agreed to it.
 */
export type CandidateRow = Record<string, unknown>;

/** Postgres' `integer` bounds — the range a 32-bit signed column accepts. */
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/** Violation examples kept per column. Enough to recognise a pattern, not a dump. */
const MAX_EXAMPLES = 5;

/** One column (or rule) that refused some rows, and what they looked like. */
export interface AuditViolation {
  /** The drizzle property name, or the rule's name for a {@link RowRule}. */
  readonly column: string;
  /** Why the value was refused, in the terms the database would use. */
  readonly reason: string;
  /** How many candidate rows are affected. */
  readonly rows: number;
  /** Up to {@link MAX_EXAMPLES} `{ id, value }` pairs, for recognising the pattern. */
  readonly examples: readonly { readonly id: unknown; readonly value: unknown }[];
}

/**
 * A constraint the column metadata cannot express — a table-level CHECK, or a
 * foreign key whose satisfaction depends on another table's rows.
 *
 * Passed in by the caller that owns the rule rather than inferred, because both
 * kinds need context this module does not have: the id sets of the tables copied
 * before this one, and the specific coherence a CHECK spells out.
 */
export interface RowRule {
  /** The constraint's own name in the schema, so a failure is greppable. */
  readonly name: string;
  /** What a row must satisfy, in the terms the database would use. */
  readonly reason: string;
  /** `true` when the row satisfies the rule. */
  readonly holds: (row: CandidateRow) => boolean;
  /** The value worth showing when it does not — usually the offending column. */
  readonly offendingValue?: (row: CandidateRow) => unknown;
}

/**
 * Collect violations, one bucket per (column, reason), capped at
 * {@link MAX_EXAMPLES}.
 *
 * The bucket carries its own `column` and `reason` rather than the key being
 * parsed back apart. A composite key that has to be SPLIT needs a separator
 * neither half can contain, and both halves here are free text — a `reason` is
 * a sentence — so the separator becomes a correctness question with no good
 * answer. Keeping both values on the bucket removes the question.
 */
class ViolationCollector {
  private readonly buckets = new Map<
    string,
    { column: string; reason: string; rows: number; examples: { id: unknown; value: unknown }[] }
  >();

  record(column: string, reason: string, id: unknown, value: unknown): void {
    // Unambiguous for any pair of strings, and deliberately never read back.
    const key = JSON.stringify([column, reason]);
    const bucket = this.buckets.get(key) ?? { column, reason, rows: 0, examples: [] };
    bucket.rows += 1;
    if (bucket.examples.length < MAX_EXAMPLES) bucket.examples.push({ id, value });
    this.buckets.set(key, bucket);
  }

  drain(): AuditViolation[] {
    return [...this.buckets.values()].map((bucket) => ({
      column: bucket.column,
      reason: bucket.reason,
      rows: bucket.rows,
      examples: bucket.examples,
    }));
  }
}

/**
 * What {@link refusalReason} needs from a column.
 *
 * A structural shape rather than drizzle's `PgColumn`, because the array case
 * recurses into `baseColumn` — a real `PgColumn` — while the object the caller
 * assembles is not one. Naming the fields lets the recursion type-check without
 * either side pretending to be the other.
 */
interface AuditableColumn {
  readonly notNull: boolean;
  readonly hasDefault: boolean;
  readonly dataType: string;
  readonly columnType: string;
  readonly enumValues?: readonly string[] | undefined;
  readonly baseColumn?: AuditableColumn | undefined;
}

/**
 * A drizzle column as the audit reads it.
 *
 * `enumValues` and `baseColumn` are declared on some column classes and not
 * others, so both are read with an `in` test rather than assumed present — the
 * alternative is `undefined.includes` firing at the moment the audit is supposed
 * to be explaining a data defect.
 */
function auditableColumn(column: PgColumn): AuditableColumn {
  const base = 'baseColumn' in column ? column.baseColumn : undefined;
  return {
    notNull: column.notNull,
    hasDefault: column.hasDefault,
    dataType: column.dataType,
    columnType: column.columnType,
    enumValues: 'enumValues' in column ? column.enumValues : undefined,
    baseColumn: isPgColumn(base) ? auditableColumn(base) : undefined,
  };
}

/**
 * Whether a value is a drizzle column.
 *
 * `PgArray.baseColumn` is typed loosely enough that TypeScript will not accept
 * it as a `PgColumn` on its own, and a structural test is the honest way to say
 * "this is a column if it declares what a column declares" — the alternative is
 * asserting a type the compiler has already said it cannot verify.
 */
function isPgColumn(value: unknown): value is PgColumn {
  return (
    typeof value === 'object' &&
    value !== null &&
    'dataType' in value &&
    'columnType' in value &&
    'notNull' in value
  );
}

/**
 * Check one value against one column's declared type.
 *
 * @returns The reason it would be refused, or `null` when it fits.
 */
function refusalReason(value: unknown, column: AuditableColumn): string | null {
  // `undefined` means the row omits the key, so the column's DEFAULT applies.
  // That is only legal where one exists; without a default an omitted NOT NULL
  // column is the same `23502` a null would be.
  if (value === undefined) {
    if (!column.notNull || column.hasDefault) return null;
    return 'omitted, and the column is NOT NULL with no default (23502)';
  }
  if (value === null) {
    return column.notNull ? 'null in a NOT NULL column (23502)' : null;
  }

  switch (column.dataType) {
    case 'string': {
      if (typeof value !== 'string') return `expected a string, got ${typeName(value)}`;
      // `text({ enum: [...] })` is the same tuple the CHECK is generated from, so
      // this IS the CHECK — read off the column rather than restated.
      if (column.enumValues && !column.enumValues.includes(value)) {
        return `not one of ${column.enumValues.join(', ')} (23514)`;
      }
      return null;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `expected a finite number, got ${typeName(value)}`;
      }
      if (column.columnType === 'PgInteger' || column.columnType === 'PgSmallInt') {
        if (!Number.isInteger(value)) return 'expected an integer, got a fraction';
        if (value < INT32_MIN || value > INT32_MAX) return 'outside the `integer` range (22003)';
      }
      // `bigint({ mode: 'number' })` hands JavaScript a `number`, so its real
      // ceiling is `Number.MAX_SAFE_INTEGER` rather than the column's 64 bits —
      // past that the VALUE is already wrong before Postgres ever sees it.
      if (column.columnType === 'PgBigInt53') {
        if (!Number.isInteger(value)) return 'expected an integer, got a fraction';
        if (!Number.isSafeInteger(value)) return 'outside the safe-integer range';
      }
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : `expected a boolean, got ${typeName(value)}`;
    case 'date':
      if (!(value instanceof Date)) return `expected a Date, got ${typeName(value)}`;
      return Number.isNaN(value.getTime()) ? 'an Invalid Date' : null;
    case 'array': {
      // No geo table has an array column, so this arm was unreachable until the
      // second batch — and an unaudited column kind is one whose bad values
      // reach the insert, which is what this module exists to prevent. The
      // ELEMENTS are checked against the base column, which carries any element
      // vocabulary: a `text({ enum }).array()` generates its CHECK from the same
      // tuple, so recursing here IS that CHECK rather than a restatement.
      if (!Array.isArray(value)) return `expected an array, got ${typeName(value)}`;
      const base = column.baseColumn;
      if (base === undefined) return null;
      for (const [index, element] of value.entries()) {
        const reason = refusalReason(element, base);
        if (reason !== null) return `element ${index}: ${reason}`;
      }
      return null;
    }
    case 'json': {
      // `jsonb` takes anything JSON can carry, which is nearly everything — so
      // the only refusal worth making is the one that would SUCCEED and be
      // wrong. A `Date` serialises to an ISO string, so it stores fine and reads
      // back as text, silently changing the value's type.
      if (value instanceof Date) {
        return 'a Date in a jsonb column — it would store as a string and read back as one';
      }
      return null;
    }
    default:
      // A dataType this module has not been taught about. Reported rather than
      // waved through: a column kind nobody checked is a column kind whose bad
      // values reach the insert, which is the failure this module exists to
      // prevent.
      return `unaudited column kind ${column.dataType}/${column.columnType}`;
  }
}

/** A value's kind, for a violation message. Distinguishes null from an object. */
function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (value instanceof Date) return 'a Date';
  return `a ${typeof value}`;
}

/**
 * An audit that accumulates across many calls.
 *
 * {@link auditRows} loads a whole table's rows before checking any of them,
 * which is right for the geo copy (under eight thousand documents) and
 * impossible for the rest: 171,976 images and 17,644 properties with their
 * embedded arrays do not fit in memory at once, so `data.ts` STREAMS and audits
 * batch by batch.
 *
 * Auditing per batch with the one-shot function would produce one grouped report
 * PER BATCH — three hundred of them, each saying "1 row" — and the grouping is
 * what makes a report readable. So the collector has to outlive the batch.
 */
export class RowAuditor {
  private readonly collector = new ViolationCollector();
  private readonly columns: ReturnType<typeof getTableColumns>;
  private readonly known: ReadonlySet<string>;
  private rowsSeen = 0;

  constructor(
    table: PgTable,
    private readonly rules: readonly RowRule[] = [],
  ) {
    this.columns = getTableColumns(table);
    this.known = new Set(Object.keys(this.columns));
  }

  /** Audit one batch. */
  add(rows: readonly CandidateRow[]): void {
    for (const row of rows) {
      this.rowsSeen += 1;

      // A key the target has no column for is a mapper bug. drizzle would throw
      // on the insert — but only after the audit had reported green, which is
      // precisely the shape this module exists to rule out.
      for (const key of Object.keys(row)) {
        if (!this.known.has(key)) {
          this.collector.record(key, 'no such column on the target table', row.id, row[key]);
        }
      }

      for (const [name, column] of Object.entries(this.columns)) {
        const reason = refusalReason(row[name], auditableColumn(column));
        if (reason !== null) this.collector.record(name, reason, row.id, row[name]);
      }

      for (const rule of this.rules) {
        if (!rule.holds(row)) {
          this.collector.record(rule.name, rule.reason, row.id, rule.offendingValue?.(row));
        }
      }
    }
  }

  /**
   * How many rows have been audited.
   *
   * The VACUITY FLOOR. "No violations" and "nothing was checked" are the same
   * report, and a streaming audit produces the second for a dozen boring reasons
   * — a collection name that matches nothing, a filter that excludes everything,
   * a cursor that closed early. A caller acting on an empty report without
   * reading this is trusting a check it never ran.
   */
  get audited(): number {
    return this.rowsSeen;
  }

  /** Every violation so far, grouped by column and reason. */
  drain(): AuditViolation[] {
    return this.collector.drain();
  }
}

/**
 * Rows colliding on a unique index — a defect `ON CONFLICT DO NOTHING` ABSORBS.
 *
 * Not the same check as a foreign key or a CHECK, and the one the copy's own
 * idempotence creates. Every insert is `ON CONFLICT DO NOTHING` with NO conflict
 * target, which covers the primary key AND every unique index: two source rows
 * carrying one `agencies.normalized_name` do not raise `23505`, they become one
 * row. Silently. The 8,374 listings pointing at the loser then fail their own
 * foreign key later, in a different table, with nothing connecting the two
 * facts.
 *
 * `key` composes the value the index sees and returns `null` for a row the index
 * does not cover — a PARTIAL unique index (`where normalized_key is not null`)
 * genuinely does not constrain those rows, and treating them as colliding would
 * report thousands of findings on a healthy collection.
 */
export class UniqueKeyAuditor {
  private readonly seen = new Map<string, unknown>();
  private readonly collector = new ViolationCollector();

  constructor(
    private readonly constraint: string,
    private readonly key: (row: CandidateRow) => string | null,
  ) {}

  add(rows: readonly CandidateRow[]): void {
    for (const row of rows) {
      const value = this.key(row);
      if (value === null) continue;
      const owner = this.seen.get(value);
      if (owner === undefined) {
        this.seen.set(value, row.id);
        continue;
      }
      this.collector.record(
        this.constraint,
        'two rows share one unique key — ON CONFLICT DO NOTHING would drop one ' +
        'of them without raising (23505 never fires)',
        row.id,
        `${value} (already held by ${String(owner)})`,
      );
    }
  }

  drain(): AuditViolation[] {
    return this.collector.drain();
  }
}

/**
 * Audit every candidate row against `table`'s columns and the caller's row
 * rules.
 *
 * @param table The drizzle table the rows are destined for. Its columns ARE the
 *   rule set — see the module doc.
 * @param rows The candidate rows, exactly as they would be inserted.
 * @param rules Table-level CHECKs and foreign keys the column metadata cannot
 *   express.
 * @returns Every violation found, grouped by column and reason. Empty means the
 *   target accepts every row.
 */
export function auditRows(
  table: PgTable,
  rows: readonly CandidateRow[],
  rules: readonly RowRule[] = [],
): AuditViolation[] {
  const auditor = new RowAuditor(table, rules);
  auditor.add(rows);
  return auditor.drain();
}

/** Render violations as the lines an operator reads in a task log. */
export function describeViolations(
  table: string,
  violations: readonly AuditViolation[],
): string[] {
  return violations.map((violation) => {
    const examples = violation.examples
      .map((example) => `${String(example.id)}=${JSON.stringify(example.value) ?? 'undefined'}`)
      .join(', ');
    return `${table}.${violation.column}: ${violation.reason} — ${violation.rows} row(s)${examples ? ` [${examples}]` : ''}`;
  });
}
