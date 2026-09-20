/**
 * Homiio's whole relationship with GoWay's map platform.
 *
 * Homiio used to carry a basemap: a third-party style URL, the knowledge of
 * which tile/sprite/glyph endpoints went with it, and the repairs that style
 * needed. It now renders **GoWay's** style document — the same cartography
 * GoWay's own app renders, authored and served by GoWay at
 * `GOWAY_MAP_STYLE_URLS` (`packages/frontend/config.ts`). Everything Homiio
 * still has to know about that document is in this one file, on purpose:
 *
 *  - WHERE it is — from configuration, never a literal in a component;
 *  - WHERE Homiio's own layers go inside it — {@link GOWAY_ANCHOR_LAYER_ID};
 *  - WHAT Homiio has to repair before handing it to MapLibre —
 *    {@link sanitizeMapStyle}, which is a bug report with a workaround attached
 *    and is meant to be deleted, not maintained.
 *
 * ## This module is standing in for `@goway.to/sdk`
 *
 * The SDK is the right dependency for all of this and is **not published to
 * npm** (`npm view @goway.to/sdk` → 404, checked 2026-09-20), so Homiio cannot
 * `bun add` it. Rather than vendor a copy of it, or reach across the filesystem
 * into GoWay's repository — either of which is exactly the coupling an SDK
 * exists to prevent — Homiio talks to GoWay's public HTTP surface through this
 * module. It is deliberately the ONLY place that does, so adopting the real SDK
 * is a deletion: re-export its equivalents from here, then delete the bodies.
 *
 * ## The style endpoint sends no CORS header, which blocks WEB only
 *
 * Measured 2026-09-20, `GET https://goway.to/map/goway-light.json` with
 * `Origin: https://homiio.com`: **200, and no `Access-Control-Allow-Origin`**
 * (`OPTIONS` answers 405). A browser therefore refuses the response, so on web
 * both this module's `fetch` AND MapLibre's own style load fail, and the map
 * renders nothing. It is not the tiles: `https://tiles.openfreemap.org/planet`,
 * the source GoWay's style names, answers `access-control-allow-origin: *`.
 *
 * Native is unaffected and this is not a coincidence — React Native's `fetch`
 * enforces no same-origin policy, and the WebView document never fetches the
 * style at all because the host inlines the hardened document into it.
 *
 * **The fix belongs to GoWay and is one response header on `/map/*.json`.**
 * Homiio deliberately does not proxy around it: a proxy is exactly the layer
 * this migration exists to remove, and it would hide the missing header from
 * every other app that adopts the style next. {@link loadGowayStyle} names the
 * cause on failure so a blank web map is never a mystery.
 */
import { useEffect, useState } from 'react';
import type { FilterSpecification, StyleSpecification } from 'maplibre-gl';

import { GOWAY_MAP_STYLE_URLS } from '@/config';

/**
 * Which of GoWay's two style documents to render. These are the keys of
 * {@link GOWAY_MAP_STYLE_URLS} and the values of the style's own
 * `metadata['goway:appearance']`.
 */
export type MapAppearance = keyof typeof GOWAY_MAP_STYLE_URLS;

/**
 * The layer GoWay publishes for consumers to position against.
 *
 * It is an invisible `background` layer sitting above the basemap's fills and
 * lines and below every label and POI layer, and its whole purpose is to be a
 * stable `beforeId`. Homiio's own layers are inserted here rather than appended
 * to the top of the style, which is the difference between "below GoWay's
 * labels, by contract" and "above everything, by accident of insertion order" —
 * and, crucially, it is a NAME rather than a guess. The alternative every app
 * without an anchor ends up writing is a scan for the first `symbol` layer,
 * which silently picks a different layer the moment the cartography changes.
 *
 * The style also advertises it at `metadata['goway:anchor:beforeLabels']`;
 * {@link resolveAnchorLayerId} prefers that declaration and falls back to this
 * constant, so a rename by GoWay lands without a Homiio release.
 */
export const GOWAY_ANCHOR_LAYER_ID = 'goway:anchor:labels';

/** Where GoWay serves the style document for an appearance. */
export const gowayStyleUrl = (appearance: MapAppearance): string =>
  GOWAY_MAP_STYLE_URLS[appearance];

/** The slice of a loaded style this module reads to find the anchor. Kept
 *  structural so it accepts both a fetched document and `map.getStyle()`. */
interface AnchorProbe {
  metadata?: unknown;
  layers?: readonly { readonly id: string }[];
}

/**
 * The anchor layer id a loaded style actually offers, or `undefined`.
 *
 * Reading the style's own `metadata['goway:anchor:beforeLabels']` declaration
 * in preference to the constant means GoWay can rename the anchor and every
 * consumer follows on the next style fetch, without a Homiio release.
 *
 * `undefined` — which is what `addLayer`'s `beforeId` parameter wants for "put
 * it on top" — is returned when the style has no such layer. That is not an
 * error to surface: a style that publishes no anchor is not broken, it simply
 * has nothing to position against, and a map that refused to draw its pins over
 * it would be a much worse outcome than pins drawn one layer too high.
 *
 * It is asked of the LIVE map (`map.getStyle()`) rather than of the document
 * Homiio fetched, because those differ in the one case that matters: when the
 * fetch failed and MapLibre loaded the URL itself, Homiio holds no document at
 * all and the live style is the only thing that can answer.
 */
export function resolveAnchorLayerId(style: AnchorProbe | null | undefined): string | undefined {
  if (!style) return undefined;
  const metadata = style.metadata as Record<string, unknown> | undefined;
  const declared = metadata?.['goway:anchor:beforeLabels'];
  const candidate = typeof declared === 'string' && declared ? declared : GOWAY_ANCHOR_LAYER_ID;
  return style.layers?.some((layer) => layer.id === candidate) ? candidate : undefined;
}

/* ------------------------------------------------------------------------- *
 * Hardening GoWay's style document
 *
 * This section is a WORKAROUND for a defect in the style GoWay serves, and the
 * measurement is recorded here so it can be deleted the day GoWay fixes it.
 *
 * Measured against both live documents on 2026-09-20 (69 layers each,
 * `goway:schema: openmaptiles-v3`): three layer filters compare a tile property
 * with an ordering operator —
 *
 *     boundary-region   [">=", ["get","admin_level"], 3]
 *     boundary-region   ["<=", ["get","admin_level"], 6]
 *     boundary-country  ["<=", ["get","admin_level"], 2]
 *
 * MapLibre wraps the property operand of `<`/`<=`/`>`/`>=` in a numeric type
 * ASSERTION, so a `boundary` feature that arrives without `admin_level` throws
 * `Expected value to be of type number, but found null instead.` during worker
 * tile parse and the boundary tiles are dropped. `==`/`!=` are null-safe and
 * are deliberately left alone.
 *
 * Note what is NOT here any more. Homiio also used to install a missing-image
 * resolver, because the previous style's POI layers set `icon-image` to the
 * OSM feature class and many of those names had no image in the sprite. GoWay's
 * documents declare **zero** `icon-image` and zero `*-pattern` properties
 * across all 138 layers, so that repair is dead and has been removed rather
 * than kept "just in case": a 1×1 transparent placeholder is a MASK, and a
 * sprite GoWay's style asks for and does not ship should be loud and GoWay's to
 * fix, not silently blanked inside Homiio.
 * ------------------------------------------------------------------------- */

/** Ordering operators that wrap their operand in a throwing numeric assertion. */
const ORDERING_OPERATORS = ['<', '<=', '>', '>='] as const;
type OrderingOperator = (typeof ORDERING_OPERATORS)[number];

const isOrderingOperator = (value: unknown): value is OrderingOperator =>
  typeof value === 'string' && (ORDERING_OPERATORS as readonly string[]).includes(value);

/**
 * A node inside a MapLibre filter. Filters are JSON, so a node is modelled as a
 * recursive JSON value for the structural walk and narrowed only to the two
 * shapes that are rewritten. This keeps the transform fully typed without `any`.
 */
type FilterNode =
  | string
  | number
  | boolean
  | null
  | FilterNode[]
  | { [key: string]: FilterNode };

type OrderingComparison = [OrderingOperator, FilterNode, FilterNode];

const isOrderingComparison = (node: FilterNode): node is OrderingComparison =>
  Array.isArray(node) && node.length === 3 && isOrderingOperator(node[0]);

/** The modern `["get", "<prop>"]` property access — the only operand shape a
 *  MapLibre expression-form comparison can take. */
const isPropertyGet = (node: FilterNode): boolean =>
  Array.isArray(node) && node.length === 2 && node[0] === 'get' && typeof node[1] === 'string';

const isNumberLiteral = (node: FilterNode): node is number =>
  typeof node === 'number' && Number.isFinite(node);

/**
 * The coalesce sentinel for `property OP bound`, chosen so an ABSENT property
 * makes the comparison `false` — the feature is filtered out, which is exactly
 * MapLibre's intent for a missing numeric property — while every value that is
 * actually present compares identically. `admin_level` is an integer, so an
 * integer sentinel is exact.
 *
 *   `>=` : false ⇔ sentinel <  bound → bound − 1
 *   `>`  : false ⇔ sentinel <= bound → bound
 *   `<=` : false ⇔ sentinel >  bound → bound + 1
 *   `<`  : false ⇔ sentinel >= bound → bound
 */
const sentinelFor = (op: OrderingOperator, bound: number): number => {
  switch (op) {
    case '>=':
      return bound - 1;
    case '>':
      return bound;
    case '<=':
      return bound + 1;
    case '<':
      return bound;
  }
};

/** The mirror operator for when the property is the RIGHT operand. */
const mirrorOperator = (op: OrderingOperator): OrderingOperator => {
  switch (op) {
    case '>=':
      return '<=';
    case '>':
      return '<';
    case '<=':
      return '>=';
    case '<':
      return '>';
  }
};

/** Wrap a property operand so an absent property yields `sentinel` rather than
 *  `null`, which keeps the operand statically typed `number` and therefore
 *  keeps MapLibre from generating a throwing assertion for it at all. */
const coalesceProperty = (propertyGet: FilterNode, sentinel: number): FilterNode => [
  'coalesce',
  propertyGet,
  sentinel,
];

/** Rewrite every unsafe ordering comparison in a filter, at any nesting depth
 *  (they appear inside `all`/`any`/`!`/`case`/`step`/`match`). */
const hardenFilterNode = (node: FilterNode): FilterNode => {
  if (Array.isArray(node)) {
    if (isOrderingComparison(node)) {
      const [op, left, right] = node;
      if (isPropertyGet(left) && isNumberLiteral(right)) {
        return [op, coalesceProperty(left, sentinelFor(op, right)), right];
      }
      if (isNumberLiteral(left) && isPropertyGet(right)) {
        return [op, left, coalesceProperty(right, sentinelFor(mirrorOperator(op), left))];
      }
    }
    return node.map(hardenFilterNode);
  }
  return node;
};

/**
 * A hardened copy of a style document: no layer filter can throw on a null
 * numeric tile property. The input is not mutated.
 */
export const sanitizeMapStyle = (style: StyleSpecification): StyleSpecification => {
  if (!Array.isArray(style.layers)) return style;
  return {
    ...style,
    layers: style.layers.map((layer) => {
      if (!('filter' in layer) || layer.filter === undefined) return layer;
      return {
        ...layer,
        filter: hardenFilterNode(layer.filter as FilterNode) as FilterSpecification,
      };
    }),
  };
};

/**
 * What a map should render right now: the appearance it is FOR, carried beside
 * the document itself.
 *
 * The pair travels together because the two arrive at different times. A theme
 * flip changes the appearance immediately and the new document only when its
 * fetch lands, so anything that reads today's appearance next to yesterday's
 * document sends the light style under a dark theme — a mismatch nothing
 * downstream can detect, because a style document is just a style document.
 *
 * `style` is a {@link StyleSpecification} when the fetch succeeded, and the bare
 * URL string when it did not: MapLibre will load the URL itself, so the map
 * still renders and the worst case is the boundary tiles the hardening exists
 * to save. A map that fails to mount is never the better answer.
 */
export interface ResolvedMapStyle {
  readonly appearance: MapAppearance;
  readonly style: string | StyleSpecification;
}

/**
 * The anchor to hand a renderer that cannot be asked about its own live style.
 *
 * When Homiio holds the document, the answer is read from it. When the fetch
 * failed and only the URL is being handed over, the documented constant is sent
 * OPTIMISTICALLY — the URL is still GoWay's, so the anchor is still almost
 * certainly there, and the renderer verifies before using it. Sending nothing
 * would append Homiio's layer over GoWay's labels on exactly the path where
 * nobody is watching.
 */
export const anchorLayerIdFor = (resolved: ResolvedMapStyle): string | undefined =>
  typeof resolved.style === 'string'
    ? GOWAY_ANCHOR_LAYER_ID
    : resolveAnchorLayerId(resolved.style);

/**
 * Fetch GoWay's style document for an appearance and harden it.
 *
 * Rejects when the document cannot be fetched or parsed, so the caller can
 * decide to fall back to the URL. It does not decide that itself: the two
 * platforms mount their maps differently and the fallback is a mounting
 * decision.
 */
export async function loadGowayStyle(
  appearance: MapAppearance,
  signal?: AbortSignal,
): Promise<StyleSpecification> {
  const url = gowayStyleUrl(appearance);
  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new Error(`GoWay map style ${appearance} answered ${response.status}`);
  }
  return sanitizeMapStyle((await response.json()) as StyleSpecification);
}

/**
 * The GoWay style for the current appearance, or `null` until the first one has
 * settled.
 *
 * Shared by both platform maps so they cannot drift on the fallback or on the
 * appearance/document pairing — the native map feeds the result into its
 * WebView document and the web map hands it straight to `maplibre-gl`, but the
 * question "which document, and has it arrived?" is the same question.
 */
export function useGowayStyle(appearance: MapAppearance): ResolvedMapStyle | null {
  const [resolved, setResolved] = useState<ResolvedMapStyle | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGowayStyle(appearance)
      .then((style) => {
        if (!cancelled) setResolved({ appearance, style });
      })
      .catch((error: unknown) => {
        // The map must always mount. MapLibre can load the URL itself; on
        // native the only thing lost is the hardening, which costs boundary
        // tiles rather than a map. On web the URL will fail the same way the
        // fetch just did, so the message above is the only thing that will tell
        // anyone why the canvas is empty — see the CORS note in this module's
        // header before concluding the map is broken.
        console.error(
          `[map] GoWay style "${appearance}" could not be loaded from ${gowayStyleUrl(appearance)}. ` +
            'On web this is almost always the missing Access-Control-Allow-Origin ' +
            'header on goway.to/map/*.json; see components/gowayMap.ts.',
          error,
        );
        if (!cancelled) setResolved({ appearance, style: gowayStyleUrl(appearance) });
      });
    return () => {
      cancelled = true;
    };
  }, [appearance]);

  return resolved;
}
