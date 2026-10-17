/**
 * Which city a person means — the place resolution behind "show me flats in
 * Barcelona", behind the `resolvePlace` capability tool
 * (`capabilities/handlers/listings.ts`), which Sindi and every other agent call
 * before searching a named place.
 *
 * ## Ambiguity is refused, and the refusal says why
 *
 * `lookupCityPlaces` answers `ambiguous` rather than picking a row, and the
 * refusal is right: choosing between two real places on a popularity tiebreak
 * is the homonym bug (ADR 0002 §12.2).
 *
 * But it was also refusing "Barcelona". Production carries THREE `cities` rows
 * named Barcelona in Spain, all with the slug `barcelona` and two of them
 * holding **zero** listings. The three rows are in three different REGIONS —
 * `Catalonia` (3 listings), `Barcelona` (0) and `barcelona` (0) — so no unique
 * index can ever remove them: several candidates for one slug ACROSS regions is
 * precisely the case ADR 0002 §12.2 says is legal and must stay legal.
 * `docs/postgres.md` carries the census.
 *
 * ## The rule, and why it is not "pick the popular one"
 *
 * **A place with no listings cannot answer a question about listings there.**
 * That is not a tiebreak on relevance — `placeLookup`'s own header forbids
 * `properties_count` deciding between candidates, and this does not ask it to.
 * It asks something narrower and true: a row holding nothing is not a possible
 * answer to "what is in it", so it is not a candidate to be ambiguous WITH.
 *
 * Two genuine Barcelonas that both hold listings are still ambiguous and still
 * refused — which is the case the rule exists to protect, and the case a
 * popularity tiebreak would have got wrong.
 *
 * It lives HERE and not in `lookupCityPlaces`, because the rule is a property
 * of the QUESTION (where to look for listings). A place picker offering
 * somewhere to browse should still show an empty city.
 *
 * ## Why a discounted-to-nothing name is `ambiguous` and not `not_found`
 *
 * When the rule leaves zero candidates — several rows carry the name and none
 * of them holds a listing — the honest sentence is still "which one did you
 * mean?". The places exist; Homiio simply cannot answer "what is in it" for any
 * of them, and telling somebody their name matched nothing would be false.
 */

import {
  type CityPlaceCandidate,
  citySelection,
  type LocationSelection,
} from '@homiio/shared-types';

import { lookupCityPlaces } from '../db/geo/placeLookup';

/**
 * How many candidates to look at before judging.
 *
 * More than two, because the duplicate rule above has to SEE the candidates to
 * tell duplicates from homonyms — asking for two is enough to learn that a name
 * is ambiguous and not enough to learn why.
 */
const CITY_CANDIDATE_LIMIT = 8;

/**
 * Why a named city produced no area.
 *
 * Two reasons, never one `null`: "which Barcelona did you mean?" is answerable
 * by naming a region; "I have no Atlantis" is not, and asking somebody to refine
 * a place that does not exist sends them looking for a spelling mistake they
 * did not make.
 */
export type UnresolvedPlaceReason = 'ambiguous' | 'not_found';

/**
 * The city a name means, or the reason Homiio cannot say which one.
 *
 * `candidates` on an ambiguous answer are every row the name matched, so the
 * caller can ask "which one?" by naming a region — they are never chosen from.
 */
export type CityResolution =
  | {
      readonly status: 'resolved';
      readonly place: CityPlaceCandidate;
      readonly selection: LocationSelection;
    }
  | {
      readonly status: 'unresolved';
      readonly reason: 'ambiguous';
      readonly candidates: readonly CityPlaceCandidate[];
    }
  | { readonly status: 'unresolved'; readonly reason: 'not_found' };

export async function resolveCity(
  city: string,
  state: string | undefined,
): Promise<CityResolution> {
  const outcome = await lookupCityPlaces({
    token: city,
    ...(state ? { region: state } : {}),
    limit: CITY_CANDIDATE_LIMIT,
  });
  if (outcome.status === 'resolved') {
    return { status: 'resolved', place: outcome.place, selection: citySelection(outcome.place) };
  }
  if (outcome.status !== 'ambiguous') return { status: 'unresolved', reason: 'not_found' };

  const withListings = outcome.candidates.filter((candidate) => candidate.propertiesCount > 0);
  return withListings.length === 1
    ? { status: 'resolved', place: withListings[0], selection: citySelection(withListings[0]) }
    : { status: 'unresolved', reason: 'ambiguous', candidates: outcome.candidates };
}
