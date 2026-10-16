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

import type { Router } from 'express';

import { AUTHENTICATED_ROUTE_COVERAGE } from '../../capabilities/routeCoverage';
import { HOMIIO_CAPABILITY_CATALOG } from '../../capabilities/homiio.catalog';
import apiRoutes from '../../routes';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  name: string;
  regexp: RegExp;
  handle: { stack?: Layer[] };
}

/** The literal mount prefix express compiled into a router layer's regexp. */
function mountPrefix(layer: Layer): string {
  const match = layer.regexp.source.match(/^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)/);
  if (!match) return '';
  return `/${match[1].replace(/\\\//g, '/')}`;
}

function walk(stack: Layer[], base: string, out: Set<string>): void {
  for (const layer of stack) {
    if (layer.route) {
      const path = `${base}${layer.route.path}`.replace(/\/+$/, '') || '/';
      for (const method of Object.keys(layer.route.methods)) {
        out.add(`${method.toUpperCase()} ${path}`);
      }
    } else if (layer.name === 'router' && layer.handle.stack) {
      walk(layer.handle.stack, base + mountPrefix(layer), out);
    }
  }
}

function authenticatedRoutes(): Set<string> {
  const routes = new Set<string>();
  walk((apiRoutes() as unknown as Router & { stack: Layer[] }).stack, '/api', routes);
  return routes;
}

describe('authenticated route ↔ catalogue parity', () => {
  const routes = authenticatedRoutes();
  const toolNames = new Set(HOMIIO_CAPABILITY_CATALOG.tools.map((tool) => tool.name));

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
