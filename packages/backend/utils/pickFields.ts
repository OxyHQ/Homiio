/**
 * Mass-assignment guard shared by every write controller (property, room, lease).
 *
 * Write endpoints must NEVER spread `req.body` straight into a Mongoose
 * create/update: that lets a client set owner/system-managed fields
 * (`profileId`, `landlordProfileId`, `status`, `signatures`, …) and reassign
 * ownership (IDOR / privilege escalation). Instead, each controller declares an
 * explicit allowlist of user-editable fields and picks ONLY those. Anything not
 * on the list is resolved server-side, derived, system-managed, or rejected.
 */

/**
 * Return a new object containing only the `allowed` keys that are actually
 * present on `body`. Never mutates `body`; never carries over unknown keys.
 *
 * `req.body` is untyped (Express types it as `any`); the picked keys form a
 * partial payload that downstream consumers (schema validators, offering rules,
 * the Mongoose model) validate field-by-field. The generic `T` lets a caller
 * name the partial-payload shape it expects at this validated boundary, so the
 * result is typed without `any` and without re-spreading the raw body.
 */
export function pickFields<T extends object>(
  body: unknown,
  allowed: readonly string[],
): Partial<T> {
  const source = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const picked: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      picked[key] = source[key];
    }
  }
  return picked as Partial<T>;
}
