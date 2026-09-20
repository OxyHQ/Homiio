/**
 * Homiio renders GoWay's cartography, and this is what that adoption rests on.
 *
 * Three things here can break without anything looking broken, which is why
 * each one is pinned rather than trusted:
 *
 *  1. **The style endpoint is configuration.** The moment a component names a
 *     URL, pointing Homiio at a GoWay staging deployment stops being possible
 *     without a release, and the fleet grows a second answer to "where is the
 *     basemap?".
 *  2. **The anchor is a NAME, not a guess.** GoWay publishes
 *     `goway:anchor:labels` so a consumer can say where its own layers go. The
 *     thing every app without an anchor writes instead — "insert before the
 *     first `symbol` layer" — keeps working and quietly points somewhere else
 *     the next time the cartography moves.
 *  3. **The hardening is load-bearing and is meant to die.** GoWay's documents
 *     still ship three filters that throw on a null numeric tile property. The
 *     rewrite that saves them is arithmetic, and arithmetic that is off by one
 *     silently changes WHICH boundaries draw — so the sentinels are checked by
 *     evaluating the comparison, not by eyeballing the shape.
 */
import type { StyleSpecification } from 'maplibre-gl';

import { GOWAY_MAP_STYLE_URLS } from '@/config';
import {
  GOWAY_ANCHOR_LAYER_ID,
  anchorLayerIdFor,
  gowayStyleUrl,
  resolveAnchorLayerId,
  sanitizeMapStyle,
} from '@/components/gowayMap';

/**
 * The three filters GoWay's live documents actually ship, copied verbatim from
 * `goway-light.json` / `goway-dark.json` on 2026-09-20 (both 69 layers,
 * `goway:schema: openmaptiles-v3`).
 *
 * A pinned specimen, not an illustration: if GoWay's cartography stops using
 * ordering comparisons the hardening becomes dead and should be deleted, and
 * the way to notice that is for this to be the thing somebody has to come back
 * and change.
 */
const GOWAY_BOUNDARY_FILTERS = [
  { layer: 'boundary-region', filter: ['>=', ['get', 'admin_level'], 3] },
  { layer: 'boundary-region', filter: ['<=', ['get', 'admin_level'], 6] },
  { layer: 'boundary-country', filter: ['<=', ['get', 'admin_level'], 2] },
] as const;

const styleWith = (layers: unknown[]): StyleSpecification =>
  ({ version: 8, sources: {}, layers } as unknown as StyleSpecification);

/**
 * Evaluate a hardened comparison the way MapLibre would, for one feature.
 *
 * Only the shape this module produces is handled — `[op, ["coalesce", ["get",
 * p], sentinel], bound]` — because the point is to check the SENTINEL, and an
 * evaluator general enough to be interesting would be a second implementation
 * of the thing under test.
 */
function evaluate(node: unknown, properties: Record<string, number>): boolean {
  const [op, left, right] = node as [string, unknown, number];
  const [, get, sentinel] = left as [string, [string, string], number];
  const value = properties[get[1]] ?? sentinel;
  switch (op) {
    case '>=':
      return value >= right;
    case '>':
      return value > right;
    case '<=':
      return value <= right;
    case '<':
      return value < right;
    default:
      throw new Error(`unhandled operator ${op}`);
  }
}

describe('where GoWay serves Homiio its basemap', () => {
  it('is configuration, never a literal in a component', () => {
    // The check that matters is not the value — it is that a component asks
    // this module, and this module asks config. A default is still a default.
    expect(gowayStyleUrl('light')).toBe(GOWAY_MAP_STYLE_URLS.light);
    expect(gowayStyleUrl('dark')).toBe(GOWAY_MAP_STYLE_URLS.dark);
  });

  it('is two documents, not one', () => {
    // Homiio's map was light in a dark app for as long as there was one style
    // URL and no caller that passed a second.
    expect(GOWAY_MAP_STYLE_URLS.light).not.toBe(GOWAY_MAP_STYLE_URLS.dark);
    for (const url of Object.values(GOWAY_MAP_STYLE_URLS)) {
      expect(url).toMatch(/^https:\/\//);
    }
  });
});

describe('the anchor Homiio positions against', () => {
  it('is the layer GoWay documents', () => {
    expect(GOWAY_ANCHOR_LAYER_ID).toBe('goway:anchor:labels');
  });

  it('is read from the style rather than assumed', () => {
    // GoWay can rename the anchor and every consumer follows on the next style
    // fetch, with no Homiio release.
    const renamed = styleWith([{ id: 'goway:anchor:v2' }, { id: GOWAY_ANCHOR_LAYER_ID }]);
    renamed.metadata = { 'goway:anchor:beforeLabels': 'goway:anchor:v2' };
    expect(resolveAnchorLayerId(renamed)).toBe('goway:anchor:v2');
  });

  it('falls back to the documented id when the style declares none', () => {
    expect(resolveAnchorLayerId(styleWith([{ id: GOWAY_ANCHOR_LAYER_ID }]))).toBe(
      GOWAY_ANCHOR_LAYER_ID,
    );
  });

  it('is undefined — append — when the style really has no anchor', () => {
    // Not an error. A style that publishes no anchor is not broken, and a map
    // that refused to draw its pins over it would be far worse than pins drawn
    // one layer too high.
    expect(resolveAnchorLayerId(styleWith([{ id: 'background' }]))).toBeUndefined();
    expect(resolveAnchorLayerId(null)).toBeUndefined();
    // A DECLARED anchor that isn't in the style is also no anchor: `beforeId`
    // pointing at a missing layer is what MapLibre throws on.
    const lying = styleWith([{ id: 'background' }]);
    lying.metadata = { 'goway:anchor:beforeLabels': 'goway:anchor:v2' };
    expect(resolveAnchorLayerId(lying)).toBeUndefined();
  });

  it('is sent optimistically when only the URL survived', () => {
    // The fetch failed, so Homiio holds no document — but the URL is still
    // GoWay's, so the anchor is still almost certainly there and the renderer
    // verifies before using it. Sending nothing would append Homiio's layer
    // over GoWay's labels on exactly the path nobody is watching.
    expect(anchorLayerIdFor({ appearance: 'light', style: GOWAY_MAP_STYLE_URLS.light })).toBe(
      GOWAY_ANCHOR_LAYER_ID,
    );
    expect(
      anchorLayerIdFor({ appearance: 'dark', style: styleWith([{ id: 'background' }]) }),
    ).toBeUndefined();
  });
});

describe('hardening the filters GoWay still ships', () => {
  it.each(GOWAY_BOUNDARY_FILTERS)(
    'rewrites $layer $filter so a missing admin_level cannot throw',
    ({ filter }) => {
      const [{ filter: hardened }] = sanitizeMapStyle(
        styleWith([{ id: 'l', filter }]),
      ).layers as unknown as { filter: unknown }[];
      const [, operand] = hardened as [string, unknown, number];
      // A `coalesce(<get>, <number>)` result is statically typed `number`, so
      // MapLibre generates no numeric assertion for it at all — which is the
      // whole mechanism. Wrapping it in anything else would not help.
      expect((operand as unknown[])[0]).toBe('coalesce');
    },
  );

  it.each(GOWAY_BOUNDARY_FILTERS)(
    'keeps $layer answering identically for a feature that HAS admin_level',
    ({ filter }) => {
      const [{ filter: hardened }] = sanitizeMapStyle(
        styleWith([{ id: 'l', filter }]),
      ).layers as unknown as { filter: unknown }[];
      const [op, , bound] = filter as unknown as [string, unknown, number];
      // Every admin_level OSM emits, and a few either side of each bound.
      for (let level = 0; level <= 12; level += 1) {
        const raw =
          op === '>=' ? level >= bound : op === '<=' ? level <= bound : false;
        expect(evaluate(hardened, { admin_level: level })).toBe(raw);
      }
    },
  );

  it.each(GOWAY_BOUNDARY_FILTERS)(
    'excludes a $layer feature whose admin_level is absent',
    ({ filter }) => {
      // MapLibre's own behaviour for a missing numeric property is to filter
      // the feature out. An off-by-one sentinel would instead DRAW boundaries
      // that carry no admin level — a change nobody would read as a bug.
      const [{ filter: hardened }] = sanitizeMapStyle(
        styleWith([{ id: 'l', filter }]),
      ).layers as unknown as { filter: unknown }[];
      expect(evaluate(hardened, {})).toBe(false);
    },
  );

  it('leaves null-safe operators alone', () => {
    // `==`/`!=` compare null-safely in MapLibre and are never wrapped in an
    // assertion. Rewriting them would change results for no reason.
    const filter = ['all', ['==', ['get', 'class'], 'city'], ['!=', ['get', 'rank'], 1]];
    const [{ filter: hardened }] = sanitizeMapStyle(
      styleWith([{ id: 'l', filter }]),
    ).layers as unknown as { filter: unknown }[];
    expect(hardened).toEqual(filter);
  });

  it('reaches a comparison nested inside all/any/case', () => {
    // The three live ones sit inside `all`. A rewrite that only looked at the
    // top level would pass every structural check above and repair nothing.
    const filter = ['all', ['==', ['get', 'class'], 'boundary'], ['>=', ['get', 'admin_level'], 3]];
    const hardenedStyle = sanitizeMapStyle(styleWith([{ id: 'l', filter }]));
    expect(JSON.stringify(hardenedStyle)).toContain('coalesce');
  });

  it('does not mutate the document it was handed', () => {
    const filter = ['>=', ['get', 'admin_level'], 3];
    const original = styleWith([{ id: 'l', filter }]);
    const before = JSON.stringify(original);
    sanitizeMapStyle(original);
    expect(JSON.stringify(original)).toBe(before);
  });
});
