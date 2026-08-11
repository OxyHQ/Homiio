/**
 * The rail layouts this app has — the vocabulary, with no React attached.
 *
 * Its own module rather than a constant inside `WidgetManager.tsx` for one
 * concrete reason: `routeRail.ts` and its totality test need to ENUMERATE these,
 * and importing them from the component pulls in every widget and, through
 * those, `expo-router` — which ships ESM this jest suite does not transform. A
 * vocabulary is data; a component that renders it is not, and a pure map should
 * not have to load a React tree to name its own values.
 *
 * An ARRAY with the union derived from it, because a TypeScript union does not
 * exist at runtime and `__tests__/widgets/routeRailTotality.test.ts` proves
 * every value here is REACHED by a route.
 *
 * Four values used to fail that and are gone. `saved-properties` named
 * `/properties/saved`, a path that has never existed in this repository's
 * history; `payments` and `messages` named routes that do not exist either — so
 * none of the three had ever rendered. `contracts` WAS reachable, but its widget
 * list was empty and an empty list makes `WidgetManager` return `null`, which
 * made it a second spelling of "no rail". "No rail" now has exactly one
 * spelling, and it lives in `routeRail.ts` as `null`.
 */
export const SCREEN_IDS = [
  'home',
  'properties',
  'property-details',
  'profile',
  'explore',
  'explore-results',
  'create-property',
] as const;

export type ScreenId = (typeof SCREEN_IDS)[number];
