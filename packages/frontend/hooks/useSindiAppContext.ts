/**
 * What Sindi is told about the app, and nothing more (#519 §8.3).
 *
 * ## The shape IS the policy
 *
 * The temptation with an assistant beside an app is to send it everything "just
 * in case" — the route, the store, the visible DOM, the user's saved list, a
 * position. #519 §8.3 lists what may never travel, and rather than restate that
 * list as a rule somebody has to remember, this hook produces a
 * {@link SindiAppContext}, which has nowhere to put any of it: no free-form
 * fields, no record type, no passthrough.
 *
 * Two values are worth naming because they look like exceptions and are not:
 *
 *  - `locationToken` is the `loc` token. By ADR 0002 §8.2 it carries no
 *    coordinate at ANY precision — the device case serialises to
 *    `here.<radiusMeters>`, with no position in it — so this is the safe
 *    reference #519 asks for ("usar una referencia segura … no copiar un
 *    `current_location` exacto al prompt de Alia").
 *  - `scopeLabel` is the AREA's display name ("Barcelona"), which is already on
 *    screen and is what lets Sindi write a sentence naming where it searched.
 *    It is never an address and never a street.
 *
 * ## The revision is the conflict detector
 *
 * It increments whenever the live query changes, and it rides with the turn.
 * An action carrying an older revision is `stale`: the user changed a filter by
 * hand after the turn was sent, and #519 §8.8 says their change wins. Derived
 * from the query's own value rather than counted by an effect, so it cannot
 * drift out of step with what was actually sent.
 */

import { useMemo } from 'react';
import { usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { serializeLocationToken, type SindiAppContext, type SindiDestination } from '@homiio/shared-types';

import { locationDisplayLabel } from '@/components/search/types';
import { useSindiControlCapability } from '@/components/sindi/sindiPanelLayout';
import { useSearchQueryStore } from '@/store/searchQueryStore';

/**
 * Which enumerated destination the user is on, or `null`.
 *
 * `null` for everything else on purpose: the destination vocabulary is the one
 * the executor can navigate to, and reporting a route Sindi cannot act on tells
 * the model nothing it can use while widening what leaves the app. A pathname
 * is not sent — it can carry ids.
 */
export function destinationOfPath(pathname: string): SindiDestination | null {
  if (pathname === '/' || pathname === '/index') return 'home';
  if (pathname.startsWith('/explore')) return 'explore';
  if (pathname.startsWith('/saved')) return 'saved';
  if (pathname.startsWith('/my-home')) return 'my_home';
  if (pathname.startsWith('/evictions')) return 'evictions';
  return null;
}

/**
 * A stable revision number for a value.
 *
 * A 32-bit FNV-1a hash of the serialised query. Not a counter: a counter lives
 * in a ref, and a ref increments on every render that happens to re-run, so two
 * hooks reading "the current revision" could disagree. A hash of the value is
 * the same number for the same query no matter who computes it or when, which
 * is the property the staleness check depends on.
 *
 * A collision would make a genuinely changed query look unchanged, so an action
 * the user had superseded could be applied. At 2^32 buckets over the handful of
 * distinct queries one person makes in a session, that is not a risk worth
 * a wider representation; and the executor's `turnId` check already refuses
 * anything from a turn that is no longer streaming.
 */
export function revisionOf(value: unknown): number {
  const text = JSON.stringify(value) ?? '';
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function useSindiAppContext(): SindiAppContext {
  const { t } = useTranslation();
  const pathname = usePathname();
  const query = useSearchQueryStore((s) => s.query);
  const { presentation } = useSindiControlCapability();

  return useMemo(() => {
    const token = query.location ? serializeLocationToken(query.location) : null;
    const scopeLabel = query.location ? locationDisplayLabel(query.location, t) : undefined;

    const context: SindiAppContext = {
      // The revision covers the QUERY only. Moving between screens does not
      // invalidate an action — "show me flats under 1200" is still the same
      // request whether it was typed on Home or on Explore.
      revision: revisionOf(query),
      presentation,
      destination: destinationOfPath(pathname),
      offering: query.offering,
      // A selection the grammar cannot express sends NO token rather than a
      // broken one. The model then has no area to name, which is honest; a
      // malformed token would come back in an action and be refused anyway.
      ...(token?.ok ? { locationToken: token.value } : {}),
      ...(scopeLabel ? { scopeLabel } : {}),
      ...(query.priceMin !== undefined ? { priceMin: query.priceMin } : {}),
      ...(query.priceMax !== undefined ? { priceMax: query.priceMax } : {}),
    };
    return context;
  }, [query, presentation, pathname, t]);
}
