/**
 * The search payload Adevinta's Spanish portals embed in every results page.
 *
 * Fotocasa and Habitaclia are the same company and, as of 2026-09, the same
 * front end: Habitaclia's listing images are served from `static.fotocasa.es`
 * and both pages ship their full search results as JSON inside the HTML. This
 * module reads that JSON. Turning it into refs is each provider's own job —
 * the two portals agree on the transport and disagree on the shape.
 *
 * WHY THIS EXISTS AT ALL. Habitaclia moved from `/alquiler-<city>.htm` to
 * `/alquiler/viviendas/<province>/<city>/s` and rebuilt its markup. The old
 * card selectors (`data-href*="-i"`) match nothing on the new page, and a
 * search that parses to zero cards is indistinguishable from a city with no
 * homes — so `discover` reported success, yielded nothing, and logged nothing.
 * Twelve consecutive discover jobs returned 0 refs with no error while Spain
 * sat at 31 listings against Germany's 481. Same shape as the 402 that started
 * all this: a silent zero wearing the costume of a normal result.
 *
 * WHY JSON RATHER THAN NEW SELECTORS. `AGENTS.md` mandates JSON/AJAX first and
 * HTML last, and here the JSON is strictly richer than the page: it carries
 * street name and number, coordinates, every image URL, the energy
 * certificate, and the advertiser's email and phone — which the classifieds
 * contact rule wants captured and which the rendered card does not show. It is
 * also stable against the cosmetic churn that just cost us a market.
 *
 * WHAT THIS DOES NOT DO: follow redirects, choose URLs, or fetch anything. The
 * legacy `/alquiler-<city>.htm` URLs still 302 to the new ones and
 * `runtime.fetchHttp` follows redirects, so the existing URL builders keep
 * working untouched — verified against pages 1, 2, 3 and 5.
 */

import { asRecord } from '../../parse/guards';

/*
 * Both portals expose the same payload under two different spellings, and both
 * are load-bearing:
 *
 *   Fotocasa:   <script id="__initial_props__" type="application/json">{…}</script>
 *   Habitaclia: window.__INITIAL_PROPS__ = JSON.parse("{\"initial…")
 *
 * The inline form is a JS *string literal* containing JSON — two levels of
 * escaping — so it cannot be read with a JSON parser alone.
 */

/**
 * The script tag's id, searched for as a LITERAL rather than matched with a
 * regex.
 *
 * The obvious pattern — `/<script[^>]*\bid="__initial_props__"[^>]*>([\s\S]*?)<\/script>/`
 * — is a polynomial ReDoS, and CodeQL says so: on a document with many
 * `<script` occurrences that do not match, `[^>]*` backtracks across each one.
 * The input here is a megabyte of attacker-influenceable HTML from a third
 * party, which is the worst possible place to put a regex that degrades with
 * repetition. This repository has already paid for one of these once.
 *
 * `indexOf` plus bounded scans is linear, has no backtracking at all, and is
 * easier to reason about than the pattern it replaces.
 */
const SCRIPT_TAG_ID = 'id="__initial_props__"';

/** The same attribute with single quotes, which is equally valid HTML. */
const SCRIPT_TAG_ID_SINGLE_QUOTED = "id='__initial_props__'";

const INLINE_ASSIGNMENT_RE = /window\.__INITIAL_PROPS__\s*=\s*JSON\.parse\(\s*"/;

/**
 * Largest embedded payload we will attempt to decode.
 *
 * A search page is ~1-2 MB and the payload is most of it. The cap is a guard
 * against a pathological or hostile response turning a parse into a memory
 * event in the worker, not a tuning knob.
 */
const MAX_PAYLOAD_CHARS = 12_000_000;

/**
 * Read the embedded search payload from a portal results page.
 *
 * Returns `undefined` when the page carries no payload — which callers must
 * treat as "could not read this page", never as "this city has no homes". That
 * conflation is the bug this module was written to end.
 */
export function extractAdevintaInitialProps(html: string): Record<string, unknown> | undefined {
  return readScriptTagPayload(html) ?? readInlinePayload(html);
}

/**
 * Fotocasa's form: a JSON-typed script tag whose body is already JSON.
 *
 * Walks the document with `indexOf` rather than a regex — see
 * {@link SCRIPT_TAG_ID}. Each step is a literal search, so the whole function
 * is linear in the length of the page.
 */
function readScriptTagPayload(html: string): Record<string, unknown> | undefined {
  let idAt = html.indexOf(SCRIPT_TAG_ID);
  if (idAt < 0) idAt = html.indexOf(SCRIPT_TAG_ID_SINGLE_QUOTED);
  if (idAt < 0) return undefined;

  // The attribute must belong to a <script> tag, not to some other element or
  // a stray occurrence inside text.
  const tagAt = html.lastIndexOf('<script', idAt);
  if (tagAt < 0) return undefined;

  const openEnd = html.indexOf('>', idAt);
  if (openEnd < 0) return undefined;

  const closeAt = html.indexOf('</script', openEnd);
  if (closeAt < 0) return undefined;

  const raw = html.slice(openEnd + 1, closeAt).trim();
  if (!raw || raw.length > MAX_PAYLOAD_CHARS) return undefined;
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/**
 * Habitaclia's form: `JSON.parse("…")` where the argument is a JS string
 * literal. Scanning to the closing quote by hand is deliberate — the literal
 * contains thousands of escaped quotes, so a regex ending at the first `"` is
 * wrong and a non-greedy one to the last `"` swallows the rest of the file.
 */
function readInlinePayload(html: string): Record<string, unknown> | undefined {
  const match = INLINE_ASSIGNMENT_RE.exec(html);
  if (!match) return undefined;

  const start = match.index + match[0].length;
  const literal = readJsStringLiteral(html, start);
  if (literal === undefined || literal.length > MAX_PAYLOAD_CHARS) return undefined;

  try {
    // Two layers: the JS literal's own escaping, then the JSON it encodes.
    return asRecord(JSON.parse(JSON.parse(`"${literal}"`) as string));
  } catch {
    return undefined;
  }
}

/**
 * Return the raw body of a double-quoted JS string literal starting at `start`
 * (the character after the opening quote), still escaped.
 *
 * `undefined` when the literal is unterminated, so a truncated response fails
 * closed rather than yielding a half-parsed page.
 */
function readJsStringLiteral(source: string, start: number): string | undefined {
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '"') return source.slice(start, i);
  }
  return undefined;
}
