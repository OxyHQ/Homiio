/**
 * Narrowing assertion for the "read it back and check it" shape these suites
 * are built on.
 *
 * `Model.findOne()` resolves to `T | null`, and the idiom throughout was
 * `expect(doc).toBeTruthy()` followed by a run of `doc.field` reads. That reads
 * fine and is not fine: `expect` is not a type guard, so every read after it was
 * unchecked. It went unnoticed because the models were reached through
 * `require('../models')`, which made them `any` — converting to imports turned
 * ~98 of those reads into real errors.
 *
 * This narrows for the compiler AND fails at runtime with something legible, so
 * a suite that stops finding its own fixture says which one instead of throwing
 * `Cannot read properties of null` twelve lines later. It exists in preference
 * to `!`, which would silence the compiler and keep the bad message.
 */
export function assertFound<T>(
  value: T | null | undefined,
  what: string,
): asserts value is NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${what} to exist, but the query returned ${String(value)}`);
  }
}
