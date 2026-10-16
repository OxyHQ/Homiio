/**
 * Which catalogue tool answers each AUTHENTICATED route, or why none does.
 *
 * Keyed `'<METHOD> <path>'` exactly as the authenticated router declares it
 * (`routes/index.ts` mounted at `/api`, no trailing slash), e.g.
 * `'POST /api/properties/:propertyId/viewings'`. The value is either the name
 * of the tool that does what the route does, as the same person, or
 * `{ excluded: <reason> }`. A route one tool per role splits (a PATCH that
 * confirms, declines or cancels) lists every tool it became.
 *
 * `__tests__/capabilities/routeParity.test.ts` walks the real router and fails
 * when a route is missing here, when an entry names a route that no longer
 * exists, or when a named tool is not in the catalogue — so a route added
 * without a decision about its tool cannot merge.
 */
export type RouteCoverageEntry = string | readonly string[] | { readonly excluded: string };
export type RouteCoverage = Readonly<Record<string, RouteCoverageEntry>>;
