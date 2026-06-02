/**
 * Backward-compat redirect: the explore surface moved from `/search` to
 * `/explore`. This route is kept only so existing links, bookmarks and
 * deep-links to `/search` keep working — it immediately forwards to `/explore`.
 *
 * Note: query-string params (`?city=`, `?offering=`, `?query=`) are preserved by
 * expo-router across this redirect (they live on the URL, not the path), so a
 * deep link like `/search?offering=short_term_rent` lands on
 * `/explore?offering=short_term_rent`.
 */
import { Redirect } from 'expo-router';

export default function SearchRedirect() {
  return <Redirect href="/explore" />;
}
