/**
 * Every authenticated route has a tool, or a written reason why not.
 *
 * "Sindi can do everything a signed-in person can do in Homiio" is only true
 * while the catalogue keeps up with the router. This walks the REAL
 * authenticated router (`routes/index.ts`, mounted at `/api` exactly as
 * `server.ts` mounts it) and fails when:
 *
 *  - a route has no entry in `capabilities/routeCoverage/*` — add its tool, or an
 *    `{ excluded: <reason> }` with a reason that is a decision;
 *  - an entry names a route that no longer exists — delete it;
 *  - an entry names a tool the catalogue does not have.
 */

import { Router } from 'express';

import { HOMIIO_CAPABILITY_CATALOG } from '../../capabilities/homiio.catalog';
import { AUTHENTICATED_ROUTE_COVERAGE } from '../../capabilities/routeCoverage';
import type * as RoutesModule from '../../routes';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  name: string;
  handle: { stack?: Layer[] };
  /** Set by `recordMountPaths`: the literal path this layer was `use`d at. */
  mountPath?: string;
}

/**
 * Express 5's router compiles a mount path into a matcher function and keeps no
 * string of it, so the walk records each path as `Router#use` receives it. The
 * route modules build their routers when they are imported, which is why this
 * runs before anything under `routes/` loads.
 */
function recordMountPaths(): void {
  const proto = Router.prototype as unknown as {
    use: (this: { stack: Layer[] }, ...args: unknown[]) => unknown;
  };
  const use = proto.use;
  proto.use = function recordingUse(this: { stack: Layer[] }, ...args: unknown[]) {
    const before = this.stack.length;
    const result = use.apply(this, args);
    const path = typeof args[0] === 'string' ? args[0] : '';
    for (const layer of this.stack.slice(before)) layer.mountPath = path === '/' ? '' : path;
    return result;
  };
}

function walk(stack: Layer[], base: string, out: Set<string>): void {
  for (const layer of stack) {
    if (layer.route) {
      const path = `${base}${layer.route.path}`.replace(/\/+$/, '') || '/';
      for (const method of Object.keys(layer.route.methods)) {
        out.add(`${method.toUpperCase()} ${path}`);
      }
    } else if (layer.name === 'router' && layer.handle.stack) {
      walk(layer.handle.stack, base + (layer.mountPath ?? ''), out);
    }
  }
}

describe('authenticated route ↔ catalogue parity', () => {
  const routes = new Set<string>();
  const toolNames = new Set(HOMIIO_CAPABILITY_CATALOG.tools.map((tool) => tool.name));

  beforeAll(() => {
    recordMountPaths();
    // biome-ignore lint/style/noCommonJs: the routers must be built after recordMountPaths patches Router#use
    const apiRoutes = (require('../../routes') as typeof RoutesModule).default;
    walk((apiRoutes() as unknown as { stack: Layer[] }).stack, '/api', routes);
  });

  it('finds the router (the walk itself works)', () => {
    expect(routes.has('POST /api/properties/:propertyId/viewings')).toBe(true);
    expect(routes.size).toBeGreaterThan(150);
  });

  it('gives every authenticated route a tool or a written exclusion', () => {
    const missing = [...routes].filter((route) => !(route in AUTHENTICATED_ROUTE_COVERAGE));
    expect(missing).toEqual([]);
  });

  it('lists no route the router does not declare', () => {
    const stale = Object.keys(AUTHENTICATED_ROUTE_COVERAGE).filter((route) => !routes.has(route));
    expect(stale).toEqual([]);
  });

  it('names only tools the catalogue has', () => {
    const unknown = Object.entries(AUTHENTICATED_ROUTE_COVERAGE).flatMap(([route, entry]) => {
      const named = typeof entry === 'string' ? [entry] : Array.isArray(entry) ? entry : [];
      return named.filter((name) => !toolNames.has(name)).map((name) => `${route} → ${name}`);
    });
    expect(unknown).toEqual([]);
  });

  it('writes every exclusion as a reason, not a placeholder', () => {
    const thin = Object.entries(AUTHENTICATED_ROUTE_COVERAGE)
      .filter(
        ([, entry]) =>
          typeof entry === 'object' && 'excluded' in entry && entry.excluded.trim().length < 30,
      )
      .map(([route]) => route);
    expect(thin).toEqual([]);
  });

  it('never exposes a scraper, admin or moderation tool (owner veto)', () => {
    const vetoed = HOMIIO_CAPABILITY_CATALOG.tools
      .map((tool) => tool.name)
      .filter((name) => /scraper|admin|moderat/i.test(name));
    expect(vetoed).toEqual([]);
  });
});
