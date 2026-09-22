/**
 * Scanning links out of a search page, without the quadratic shape.
 *
 * Nine providers wrote the same regex to pull detail links out of search HTML:
 *
 *     /href=["']([^"']*\/inmueble\/(\d+)\/[^"']*)["']/gi
 *
 * It reads naturally and it is quadratic. Two unbounded `[^"']*` sit on either
 * side of the literal, so on a long run of non-quote characters that never
 * contains the literal, the engine retries from every start position and
 * rescans the run each time — O(n²) in the length of that run. CodeQL calls it
 * `js/polynomial-redos`, and a search page is attacker-influenced input by
 * definition: it is a remote portal's HTML.
 *
 * The fix is to stop asking one pattern two questions. {@link hrefValues}
 * finds attribute values — a literal prefix and ONE bounded run, so each
 * character is visited once — and the caller then tests each short URL with a
 * pattern that has no unbounded prefix at all.
 *
 * Splitting also costs nothing in practice: the old regex scanned the whole
 * document either way, and an href is tens of characters.
 */

/**
 * Every `href="…"` / `href='…'` value in the document, in source order.
 *
 * Duplicates are NOT collapsed: callers dedupe on the id they extract, which is
 * the identity that matters, and two different URLs can carry one id.
 */
export function* hrefValues(html: string): Generator<string> {
  const pattern = /href=["']([^"']*)["']/gi;
  for (const match of html.matchAll(pattern)) {
    if (match[1]) yield match[1];
  }
}

/**
 * Detail ids from every href that carries `/<segment>/<digits>/`.
 *
 * `segment` is a fixed path word supplied by a provider module (`inmueble`,
 * `immobili`, `imovel`, …), never by fetched content — but it is escaped anyway,
 * because "this argument is always a literal" is a property of today's callers
 * and not of the function.
 *
 * The trailing slash is REQUIRED, matching the regexes this replaced. Dropping
 * it would silently widen every one of those providers at once.
 */
export function* detailIds(html: string, segment: string): Generator<string> {
  const escaped = segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const idPattern = new RegExp(`/${escaped}/(\\d+)/`);
  for (const href of hrefValues(html)) {
    const id = idPattern.exec(href)?.[1];
    if (id) yield id;
  }
}
