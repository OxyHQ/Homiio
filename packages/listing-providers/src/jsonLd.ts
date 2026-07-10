/**
 * Shared schema.org JSON-LD graph helpers.
 *
 * Market-specific flatteners (`providers/es/jsonLd`, `providers/it/jsonLd`,
 * `providers/us/jsonLd`) own amenity/currency defaults. This module owns the
 * DOM-free block extraction + `@graph` / `@id` resolution every market needs.
 */

const LD_JSON_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collect every record node from LD+JSON script blocks (`@graph` unwrapped). */
export function collectJsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  for (const match of html.matchAll(LD_JSON_RE)) {
    const body = match[1]?.trim();
    if (!body) continue;
    try {
      collectNodes(JSON.parse(body) as unknown, nodes);
    } catch {
      continue;
    }
  }
  return nodes;
}

function collectNodes(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectNodes(entry, out);
    return;
  }
  if (!isRecord(value)) return;
  if (Array.isArray(value['@graph'])) {
    collectNodes(value['@graph'], out);
    return;
  }
  out.push(value);
}

export function jsonLdTypes(node: Record<string, unknown>): string[] {
  const t = node['@type'];
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

/** Resolve `{ "@id": "…" }` references against a collected node list. */
export function resolveJsonLdRef(
  nodes: readonly Record<string, unknown>[],
  ref: unknown,
): Record<string, unknown> | undefined {
  if (isRecord(ref) && !ref['@id'] && Object.keys(ref).length > 1) return ref;
  const id = isRecord(ref) ? (typeof ref['@id'] === 'string' ? ref['@id'] : undefined) : typeof ref === 'string' ? ref : undefined;
  if (!id) return undefined;
  return nodes.find((node) => node['@id'] === id);
}

export function findJsonLdByType(
  nodes: readonly Record<string, unknown>[],
  typeName: string,
): Record<string, unknown> | undefined {
  return nodes.find((node) => jsonLdTypes(node).includes(typeName));
}
