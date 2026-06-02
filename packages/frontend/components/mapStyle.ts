/**
 * MapLibre style hardening for the keyless OpenFreeMap "liberty" style.
 *
 * The property-detail map (and every other Homiio map) renders the third-party
 * OpenFreeMap **liberty** style by URL. That style ships two defects against the
 * live OpenMapTiles `planet` tiles that surface as console errors on the GL map:
 *
 *  1. **Missing sprite image (e.g. "office").** The `poi_*` symbol layers set
 *     `icon-image` to the OSM feature's `class`/`subclass` (a `match`/`get`
 *     expression). Many classes — `office`, and others — have **no image in the
 *     liberty sprite**, so MapLibre logs
 *     `Image "office" could not be loaded …` and fires `styleimagemissing`.
 *     Fixed at runtime by {@link installMissingImageFallback}: a
 *     `styleimagemissing` listener that registers a 1×1 transparent placeholder
 *     for any missing id, so no POI class can request a non-existent image.
 *
 *  2. **Typed ordering comparison on a null property.** Several layers filter
 *     with `[">=", ["get","rank"], 1]`, `["<", ["get","rank"], 20]`,
 *     `[">=", ["get","admin_level"], 3]`, `["<=", ["get","ref_length"], 6]`,
 *     etc. MapLibre's `<`/`<=`/`>`/`>=` operators wrap the property operand in a
 *     numeric type-**assertion**; when a tile feature is missing that numeric
 *     property the assertion throws
 *     `Expected value to be of type number, but found null instead.` during
 *     worker tile `parse`. Fixed by {@link sanitizeMapStyle}: it rewrites the
 *     property operand of every unsafe ordering comparison to
 *     `["coalesce", <operand>, <sentinel>]`, where the sentinel is chosen per
 *     operator so an **absent** property evaluates the comparison to `false`
 *     (the feature is filtered out — exactly MapLibre's intent for a missing
 *     numeric property), while every present value compares identically. The
 *     `coalesce(<operand>, <number>)` result is statically typed `number`, so no
 *     throwing assertion is ever generated.
 *
 * `==`/`!=` are intentionally left untouched: they are null-safe in MapLibre and
 * are never wrapped in a numeric assertion.
 *
 * Both helpers are shared by the web map (`Map.web.tsx`, which drives
 * `maplibre-gl` directly) and the native map (`mapDocument.ts`, which serializes
 * the sanitized style into the WebView document), so the two platforms render
 * the identical, hardened style.
 *
 * This does **not** patch a package we own — OpenFreeMap publishes the style — so
 * hardening the loaded document at the boundary is the correct fix.
 */
import type { FilterSpecification, StyleSpecification } from 'maplibre-gl';

/**
 * Raw RGBA image object accepted by the public `Map.addImage(id, image)` — the
 * `{ width, height, data }` form (same layout as the DOM `ImageData`). We type
 * the placeholder against this rather than the internal `StyleImageData`
 * (whose `data` is MapLibre's private `RGBAImage` class).
 */
interface RawImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** Endpoint serving the keyless OpenFreeMap "liberty" vector style. */
export const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** MapLibre ordering comparison operators that wrap their operand in a numeric
 *  assertion (and therefore throw on a null property). `==`/`!=` are excluded:
 *  they compare null-safely and need no hardening. */
const ORDERING_OPERATORS = ['<', '<=', '>', '>='] as const;
type OrderingOperator = (typeof ORDERING_OPERATORS)[number];

const isOrderingOperator = (value: unknown): value is OrderingOperator =>
  typeof value === 'string' &&
  (ORDERING_OPERATORS as readonly string[]).includes(value);

/**
 * A node inside a MapLibre filter / expression. Filters are JSON, so we model a
 * node as a recursive JSON value for the structural walk and only narrow to the
 * concrete shapes we rewrite (`["get", <prop>]` and ordering comparisons). This
 * keeps the transform fully typed without `as any`.
 */
type FilterNode =
  | string
  | number
  | boolean
  | null
  | FilterNode[]
  | { [key: string]: FilterNode };

/** A two-operand ordering comparison expression, e.g. `[">=", <a>, <b>]`. */
type OrderingComparison = [OrderingOperator, FilterNode, FilterNode];

const isOrderingComparison = (node: FilterNode): node is OrderingComparison =>
  Array.isArray(node) && node.length === 3 && isOrderingOperator(node[0]);

/**
 * A property-access operand that MapLibre would coerce to a number for an
 * ordering comparison: the modern `["get", "<prop>"]` form. (The liberty style
 * uses the modern form exclusively; legacy bare-string operands are not valid
 * inside expression-form comparisons, so only this shape needs hardening.)
 */
const isPropertyGet = (node: FilterNode): boolean =>
  Array.isArray(node) && node.length === 2 && node[0] === 'get' && typeof node[1] === 'string';

const isNumberLiteral = (node: FilterNode): node is number =>
  typeof node === 'number' && Number.isFinite(node);

/**
 * Compute the coalesce sentinel for the property operand of `property OP bound`
 * so that an **absent** property (sentinel value) makes the comparison `false`
 * — i.e. the feature is excluded, matching MapLibre's behaviour for a missing
 * numeric property. The liberty fields involved (`rank`, `admin_level`,
 * `ref_length`, `capital`, `oneway`, `ramp`) are integers, so integer sentinels
 * are exact.
 *
 *   `>=` : false ⇔ sentinel <  bound → bound − 1
 *   `>`  : false ⇔ sentinel <= bound → bound
 *   `<=` : false ⇔ sentinel >  bound → bound + 1
 *   `<`  : false ⇔ sentinel >= bound → bound
 */
const sentinelForPropertyComparison = (op: OrderingOperator, bound: number): number => {
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

/** The mirror operator for when the property is the RIGHT operand (`bound OP
 *  property`), so the same sentinel rule applies as if the property were left. */
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

/** Wrap a property-access operand so an absent property yields `sentinel`
 *  instead of `null`, keeping the operand statically typed `number`. */
const coalesceProperty = (propertyGet: FilterNode, sentinel: number): FilterNode => [
  'coalesce',
  propertyGet,
  sentinel,
];

/**
 * Recursively harden a filter / expression node: rewrite any ordering
 * comparison between a `["get", …]` property operand and a numeric literal so a
 * missing property can't throw, then recurse into every child (comparisons can
 * be nested inside `all`/`any`/`!`/`case`/`step`/`match`/…).
 */
const hardenFilterNode = (node: FilterNode): FilterNode => {
  if (Array.isArray(node)) {
    if (isOrderingComparison(node)) {
      const [op, left, right] = node;
      // property OP number  →  (coalesce property, sentinel) OP number
      if (isPropertyGet(left) && isNumberLiteral(right)) {
        return [op, coalesceProperty(left, sentinelForPropertyComparison(op, right)), right];
      }
      // number OP property  →  number OP (coalesce property, mirrored sentinel)
      if (isNumberLiteral(left) && isPropertyGet(right)) {
        return [
          op,
          left,
          coalesceProperty(right, sentinelForPropertyComparison(mirrorOperator(op), left)),
        ];
      }
    }
    return node.map(hardenFilterNode);
  }
  return node;
};

/**
 * Return a hardened copy of a MapLibre style: every layer filter is run through
 * {@link hardenFilterNode} so no typed ordering comparison can throw on a null
 * property. The input style is not mutated.
 */
export const sanitizeMapStyle = (style: StyleSpecification): StyleSpecification => {
  if (!Array.isArray(style.layers)) return style;
  return {
    ...style,
    layers: style.layers.map((layer) => {
      if (!('filter' in layer) || layer.filter === undefined) return layer;
      const hardened = hardenFilterNode(layer.filter as FilterNode);
      return { ...layer, filter: hardened as FilterSpecification };
    }),
  };
};

/**
 * Fetch a style document by URL and return a hardened copy via
 * {@link sanitizeMapStyle}. Throws if the style cannot be fetched/parsed so the
 * caller can fall back to loading the raw URL (worst case: the original noisy
 * log returns, but the map still renders).
 */
export const fetchSanitizedMapStyle = async (
  styleURL: string,
): Promise<StyleSpecification> => {
  const response = await fetch(styleURL);
  if (!response.ok) {
    throw new Error(`Failed to load map style (${response.status}) from ${styleURL}`);
  }
  const style = (await response.json()) as StyleSpecification;
  return sanitizeMapStyle(style);
};

/** A 1×1 fully-transparent RGBA image used as the placeholder for any sprite the
 *  active style references but doesn't ship. */
const makeTransparentImage = (): RawImage => ({
  width: 1,
  height: 1,
  data: new Uint8Array([0, 0, 0, 0]),
});

/** Minimal surface of the MapLibre map needed to install the fallback — kept
 *  structural so it works against both a real `maplibre-gl` Map and any
 *  API-compatible instance, without importing the heavy class type here. */
interface MissingImageMap {
  hasImage: (id: string) => boolean;
  addImage: (id: string, image: RawImage) => void;
  on: (type: 'styleimagemissing', listener: (event: { id: string }) => void) => void;
}

/**
 * Register a `styleimagemissing` handler that supplies a 1×1 transparent
 * placeholder for any sprite id the style requests but the sprite lacks (e.g.
 * the liberty `poi_*` layers asking for `office`). Idempotent per id. This is
 * the idiomatic MapLibre remedy for missing sprite images and silences the
 * `Image "<id>" could not be loaded …` error at the root.
 */
export const installMissingImageFallback = (map: MissingImageMap): void => {
  map.on('styleimagemissing', ({ id }) => {
    // Register the requested id directly (guarded) so MapLibre resolves it and
    // stops re-firing `styleimagemissing` for the same sprite name.
    if (!id || map.hasImage(id)) return;
    map.addImage(id, makeTransparentImage());
  });
};
