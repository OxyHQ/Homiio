/**
 * Refusing a write that was handed the ROOT connection where a TRANSACTION was
 * required.
 *
 * ## What this replaces, and why a type is not enough
 *
 * Under Mongo the invariant was `session.inTransaction()`. The TYPE made the
 * session mandatory; that runtime check made it mandatory that a transaction was
 * actually OPEN — because a required parameter is satisfied by any session,
 * including a bare `startSession()` nobody opened a transaction on, which
 * type-checks perfectly and commits the row on its own.
 *
 * Drizzle has the same hole, and a wider one. `DatabaseOrTransaction` is the
 * parameter type every repository in this package takes, and the ROOT `Database`
 * satisfies it — so `enqueueModerationOutboxEvent(input, getDb())` compiles,
 * runs, commits the outbox row alone, and passes any test that only asserts the
 * row exists. It is also the DEFAULT everywhere else: `roommateRepository`,
 * `savedSearchRepository` and every other repository here take that same type,
 * so the mistake is what you get by FORGETTING to thread the handle through
 * rather than by writing a wrong one.
 *
 * The failure it produces is the one this whole pipeline exists to prevent: a
 * report answered 201 whose delivery row never committed with it, discovered
 * weeks later when somebody asks why a case never opened.
 *
 * ## The discriminator
 *
 * The root database is a `PostgresJsDatabase` with NO `rollback`; a transaction
 * handle is a `PostgresJsTransaction` whose `rollback` IS a function — for a
 * nested (savepoint) transaction too, which is what makes this safe inside a
 * caller that already opened one. `rollback` is the method a transaction has
 * BECAUSE it is one, so this tests what the handle can DO rather than a name
 * that happens to differ.
 *
 * `instanceof PgTransaction` was the alternative and is worse here: it holds
 * only while exactly one copy of drizzle is installed, which is a property of
 * the installer's hoisting rather than of this code — and bun's linker modes put
 * packages in different places, so it is not even a stable property of this
 * repo.
 */

import type { DatabaseOrTransaction, Transaction } from '../postgres';

/**
 * Raised when a write that must commit with its domain row is handed the root
 * connection.
 *
 * Never expected at runtime — it exists so the invariant is ENFORCED rather than
 * reviewed.
 */
export class MissingTransactionError extends Error {
  constructor(operation: string) {
    super(
      `Refusing to run '${operation}' outside a transaction: it must commit together ` +
        'with the domain write it belongs to, or a report is answered 201 and never ' +
        'delivered. Pass the handle from `db.transaction(...)`, not `getDb()`.',
    );
    this.name = 'MissingTransactionError';
  }
}

/**
 * Narrow a `DatabaseOrTransaction` to a transaction, or throw.
 *
 * @throws {MissingTransactionError} When handed the root connection.
 */
export function requireTransaction(
  db: DatabaseOrTransaction,
  operation: string,
): Transaction {
  const rollback: unknown = (db as { rollback?: unknown }).rollback;
  if (typeof rollback !== 'function') {
    throw new MissingTransactionError(operation);
  }
  return db as Transaction;
}
