/**
 * Backward-compat redirect for the path-param form `/search/<query>`. The
 * explore surface moved from `/search` to `/explore`; this route is kept only so
 * existing links/bookmarks/deep-links to `/search/<query>` keep working. It
 * preserves the `query` segment and forwards to `/explore/<query>` (falling back
 * to `/explore` when the segment is missing).
 */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function SearchQueryRedirect() {
  const params = useLocalSearchParams<{ query?: string | string[] }>();
  const raw = params.query;
  const query = Array.isArray(raw) ? raw[0] : raw;

  if (!query) {
    return <Redirect href="/explore" />;
  }
  return <Redirect href={`/explore/${query}`} />;
}
