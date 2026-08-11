/**
 * Every route in `app/` has a rail decided for it, and none inherits one (#423).
 *
 * ## Why the route list is DERIVED and not written here
 *
 * A hand-written list of routes is the same instrument as the hand-written list
 * of path segments this change deleted from `RightBar` (`my`, `saved`, `eco`,
 * `type`, `city` — the segments that are not property ids), and it failed the
 * same way: it had to name every case, and it did not, so `/properties/drafts`
 * became a property id. `homeSectionsController`'s place types failed this way
 * in #416 too — three of six values unhandled, 400ing in production.
 *
 * So the routes come from the `app/` TREE, and this file's job is to make a
 * route that is absent from `ROUTE_RAIL` a failing test rather than a silent
 * default. Adding a screen now forces a rail decision. That is the whole point.
 *
 * ## Why a filesystem walk rather than `git ls-files`
 *
 * The repository's other scans use `git ls-files`, correctly: they ask "is this
 * pattern anywhere in the tracked source", where git's index is the authority
 * and build output is excluded for free. This asks a different question — "what
 * routes does the ROUTER serve" — and expo-router resolves routes from the
 * filesystem. An untracked file under `app/` is a live route in development, and
 * a scan that could not see it would report a total map while the router had a
 * route the map does not know. `app/` holds no build output, so the usual reason
 * to prefer the index does not apply here.
 *
 * ## The anti-vacuity defences
 *
 *  - `routeFromFile` is pinned with POSITIVE cases (a group segment, an index, a
 *    dynamic segment, a nested dynamic segment) and NEGATIVE ones (`_layout`,
 *    `+html`, `+not-found`, a platform-suffixed layout). A derivation that
 *    stopped producing routes would otherwise report an empty tree as clean.
 *  - A FLOOR on routes discovered. `expect([]).toEqual([])` is exactly what a
 *    broken walk produces.
 *  - The check runs in BOTH directions — no route missing from the map, and no
 *    map entry that is not a route — because a one-way check lets the map rot
 *    into a list of paths that no longer exist.
 *  - Every `ScreenId` must be reached by some route, so a widget set cannot go
 *    on existing after the route that displayed it is gone. That is how
 *    `saved-properties` survived pointing at a path that never existed.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { SCREEN_IDS, type ScreenId } from '@/components/widgets/screenIds';
import { ROUTE_RAIL, railForPathname } from '@/components/widgets/routeRail';

/** The router's directory. */
const APP_DIR = join(__dirname, '..', '..', 'app');

/**
 * Filenames that are NOT routes.
 *
 * `_layout` wraps routes, `+html` is the web document shell, and `+not-found` is
 * the fallback screen — it has no pathname of its own, which is precisely why
 * `railForPathname`'s unmatched residual exists.
 */
const NON_ROUTE_BASENAMES = new Set(['_layout', '+html', '+not-found']);

/** A platform variant resolves to the SAME route as its base file. */
const PLATFORM_SUFFIX = /\.(web|native|ios|android)$/;

const SOURCE_EXTENSION = /\.(tsx|ts|jsx|js)$/;

/**
 * The route a file under `app/` serves, or `null` when it serves none.
 *
 * Three expo-router rules, and all three are places a hand-transcribed list gets
 * it wrong: a `(group)` segment is transparent, `index` IS its directory, and a
 * `.web`/`.native` suffix is the same route twice.
 *
 * Exported implicitly through the tests below rather than from the app bundle:
 * this is test-only machinery, and `node:fs` must never reach a React Native
 * bundle.
 */
export function routeFromFile(relativePath: string): string | null {
  if (!SOURCE_EXTENSION.test(relativePath)) return null;

  const withoutExtension = relativePath.replace(SOURCE_EXTENSION, '');
  const parts = withoutExtension.split('/');
  const basename = parts[parts.length - 1].replace(PLATFORM_SUFFIX, '');
  if (NON_ROUTE_BASENAMES.has(basename)) return null;

  const segments = [...parts.slice(0, -1), basename].filter(
    (segment) => !(segment.startsWith('(') && segment.endsWith(')')),
  );
  if (segments[segments.length - 1] === 'index') segments.pop();

  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/** Every file under `app/`, as a path relative to it. */
function filesUnder(dir: string, prefix: string[] = []): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...filesUnder(join(dir, entry.name), [...prefix, entry.name]));
    } else {
      found.push([...prefix, entry.name].join('/'));
    }
  }
  return found;
}

/** Every route the router serves, deduplicated across platform variants. */
function appRoutes(): string[] {
  const routes = new Set<string>();
  for (const file of filesUnder(APP_DIR)) {
    const route = routeFromFile(file);
    if (route !== null) routes.add(route);
  }
  return [...routes].sort();
}

/**
 * Sized against the tree at the time of writing (69 routes) with room to
 * shrink. A walk that broke entirely returns zero, and no ordinary deletion
 * takes the app below this.
 */
const MINIMUM_ROUTES = 45;

/** A pathname for a pattern: each `[param]` becomes a plausible value. */
function concrete(pattern: string): string {
  return pattern.replace(/\[([^\]]+)\]/g, (_match, name: string) => `a-real-${name}`);
}

const ROUTES = appRoutes();
const MAPPED = Object.keys(ROUTE_RAIL).sort();

describe('routeFromFile follows expo-router, not a guess', () => {
  it('treats a (group) segment as transparent and index as its directory', () => {
    expect(routeFromFile('(tabs)/index.tsx')).toBe('/');
    expect(routeFromFile('(tabs)/saved/index.tsx')).toBe('/saved');
    expect(routeFromFile('settings/index.tsx')).toBe('/settings');
  });

  it('keeps dynamic segments verbatim, at any depth', () => {
    expect(routeFromFile('explore/[query].tsx')).toBe('/explore/[query]');
    expect(routeFromFile('(tabs)/saved/[folderId]/edit.tsx')).toBe('/saved/[folderId]/edit');
    expect(routeFromFile('properties/[id]/book-viewing.tsx')).toBe(
      '/properties/[id]/book-viewing',
    );
  });

  it('resolves a platform variant to the same route as its base file', () => {
    // Otherwise `_layout.web.tsx` reads as a route called `/_layout.web`, and a
    // real screen's `.web` variant would demand a second map entry.
    expect(routeFromFile('(tabs)/_layout.web.tsx')).toBeNull();
    expect(routeFromFile('explore/index.web.tsx')).toBe('/explore');
  });

  it('rejects the files that are not routes', () => {
    // The NEGATIVE control. A derivation that returned a route for these would
    // make the map permanently, unfixably incomplete.
    expect(routeFromFile('_layout.tsx')).toBeNull();
    expect(routeFromFile('(tabs)/_layout.tsx')).toBeNull();
    expect(routeFromFile('+html.tsx')).toBeNull();
    expect(routeFromFile('+not-found.tsx')).toBeNull();
    expect(routeFromFile('styles/colors.css')).toBeNull();
  });
});

describe('the route→rail map is TOTAL', () => {
  it('walks enough of app/ that a broken traversal cannot pass as clean', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(MINIMUM_ROUTES);
  });

  it('finds a rail decision for every route the router serves', () => {
    // THE GATE. A route absent from `ROUTE_RAIL` used to inherit Home's widgets
    // by falling through `RightBar`'s ladder; now it fails here, by name.
    const undecided = ROUTES.filter((route) => !(route in ROUTE_RAIL));
    expect(undecided).toEqual([]);
  });

  it('has no entry for a route that does not exist', () => {
    // The other direction, and not symmetry for its own sake: `saved-properties`
    // pointed at `/properties/saved` for the whole life of this repository, a
    // path no file has ever served, and nothing said so.
    const orphans = MAPPED.filter((pattern) => !ROUTES.includes(pattern));
    expect(orphans).toEqual([]);
  });

  it('reaches every rail layout from at least one route', () => {
    // A widget set nothing can display is dead code that reads as a feature.
    const reached = new Set<ScreenId | null>(
      Object.values(ROUTE_RAIL).map((assignment) => assignment.rail),
    );
    const unreachable = SCREEN_IDS.filter((id) => !reached.has(id));
    expect(unreachable).toEqual([]);
  });

  it('has no two patterns that could match the same pathname', () => {
    // Two patterns differing only in a param NAME would both match, and which
    // one wins would depend on object key order. Nothing in the matcher would
    // report it.
    const shapes = MAPPED.map((pattern) => pattern.replace(/\[[^\]]+\]/g, '[*]'));
    expect(shapes.length - new Set(shapes).size).toBe(0);
  });
});

describe('railForPathname agrees with the map for every real route', () => {
  it('matches each route to its own pattern', () => {
    // The map being total is worth nothing if the MATCHER cannot find the entry.
    // Checked over every route rather than a sample, because the cases that go
    // wrong are the ones nobody thinks to sample.
    const mismatched = ROUTES.filter(
      (route) => railForPathname(concrete(route)).pattern !== route,
    );
    expect(mismatched).toEqual([]);
  });

  it('returns the rail the map declares, for every route', () => {
    // `?.` deliberately: an entry MISSING from the map is the case above's to
    // report, and reading `.rail` off `undefined` here would replace that
    // named-route failure with a TypeError pointing at this line. `undefined`
    // never equals the resolver's `null`, so a missing route still lands in
    // `disagreeing` — it is named twice rather than crashing once.
    const disagreeing = ROUTES.filter(
      (route) => railForPathname(concrete(route)).screenId !== ROUTE_RAIL[route]?.rail,
    );
    expect(disagreeing).toEqual([]);
  });

  it('prefers a static segment over a dynamic one', () => {
    // `/properties/create` and `/properties/[id]` both match `/properties/create`.
    // The replaced code needed an ordered ladder to get this right; here it is a
    // property of the matcher, so map order cannot break it.
    expect(railForPathname('/properties/create').pattern).toBe('/properties/create');
    expect(railForPathname('/properties/create').screenId).toBe('create-property');
  });

  it('ignores a query string and a trailing slash', () => {
    expect(railForPathname('/explore?q=barcelona').screenId).toBe('explore');
    expect(railForPathname('/properties/').pattern).toBe('/properties');
  });
});

describe('an unrecognised pathname gets NO rail', () => {
  it('renders nothing rather than Home', () => {
    // The one residual in the system. It used to be `return 'home'`, which is
    // why forty-nine routes wore Home's rail; the mutation that restores it
    // fails here.
    for (const pathname of ['/definitely-not-a-route', '/properties/[id]/nope', '/a/b/c/d/e']) {
      expect(railForPathname(pathname)).toEqual({ screenId: null, pattern: null });
    }
  });
});

describe('the defects the ladder was hiding', () => {
  it('does not treat a non-id path segment as a property id', () => {
    // Measured before the change: `/properties/drafts` mounted
    // `PropertyBookingWidget` with `propertyId="drafts"`, whose `useProperty`
    // is `enabled: Boolean(id)` — so each of these issued a doomed
    // `GET /api/properties/<segment>`.
    for (const pathname of [
      '/properties/drafts',
      '/properties/recently-viewed',
      '/properties/address-detail',
      '/properties/my',
    ]) {
      expect(railForPathname(pathname).propertyId).toBeUndefined();
    }
  });

  it('still reads the property id on a real detail route', () => {
    // The positive control for the case above: a resolver that returned
    // `undefined` for everything would pass it and break every detail page.
    expect(railForPathname('/properties/68a1f0c2b9').propertyId).toBe('68a1f0c2b9');
    expect(railForPathname('/properties/68a1f0c2b9/apply').propertyId).toBe('68a1f0c2b9');
    expect(railForPathname('/properties/68a1f0c2b9').screenId).toBe('property-details');
  });

  it('gives a filtered LIST the list rail, not the detail rail', () => {
    expect(railForPathname('/properties/city/barcelona').screenId).toBe('properties');
    expect(railForPathname('/properties/city/barcelona').city).toBe('barcelona');
    expect(railForPathname('/properties/city/barcelona').propertyId).toBeUndefined();
    expect(railForPathname('/properties/type/apartment').screenId).toBe('properties');
  });

  it('gives the pages that only ever inherited Home no rail at all', () => {
    // A sample of the forty-nine. Each of these rendered Home's widgets —
    // including, until #422, a globally unscoped property feed.
    for (const pathname of [
      '/saved',
      '/reviews',
      '/roommates',
      '/viewings',
      '/tips',
      '/settings',
      '/evictions',
      '/inbox',
      '/contracts',
    ]) {
      expect(railForPathname(pathname).screenId).toBeNull();
    }
  });

  it('leaves the routes that CHOSE a rail with the one they chose', () => {
    // The floor for the case above: assigning `null` to everything would satisfy
    // it and delete the rail from the app.
    expect(railForPathname('/').screenId).toBe('home');
    expect(railForPathname('/properties').screenId).toBe('properties');
    expect(railForPathname('/explore').screenId).toBe('explore');
    expect(railForPathname('/explore/barcelona').screenId).toBe('explore-results');
    expect(railForPathname('/profile').screenId).toBe('profile');
    expect(railForPathname('/profile/edit').screenId).toBe('profile');
  });
});
