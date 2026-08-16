# Frontend conventions: layout shell, tokens and the primitives

> Moved out of `AGENTS.md` unchanged. Bloom's own rules live in
> `~/Oxy/Bloom/AGENTS.md`; this is what is true of Homiio's use of them.

## Layout shell and design tokens (CRITICAL)

### ContentPanel (Bloom, Mention-shaped)

The center column uses Bloom `ContentPanel` (`framed` plus `maskColor`), **not** a
flat `mainContentWrapper` or a custom bleed mask. Reference: Mention
`app/(app)/_layout.tsx`.

- `framed={Platform.OS === 'web' && isScreenNotMobile}` (500 px wide or more).
- `maskColor={theme.colors.background}`, unscoped, matching the page background.
- Native phone: `framed={false}`, full bleed.
- Explore is fixed-viewport: no page scroll, but it still wraps the center in
  ContentPanel when framed.
- **Never hand-roll a bleed mask.** ContentPanel owns it.

### Scroll ownership (one owner per surface)

Web default is **document scroll**. Do NOT wrap SideBar plus Slot in a
layout-level `Animated.ScrollView`. The layout is a static flex row; only the
screen (or the document on web) scrolls.

| Surface | Owner |
|---|---|
| Web (default) | Document |
| Native tabs | Screen `Animated.ScrollView` (local SharedValue) |
| Explore | Fixed shell (no page scroll) |

Remove `LayoutScrollProvider` and the layout scroll handler when not needed. No
dual writers of `scrollY`. Sticky header `top` is Bloom `PANEL_TOP_INSET` when
framed.

### Section stacking (NativeWind gap)

Use NativeWind `gap-6 md:gap-8` on the section container, **not** per-section
`marginTop: sectionGap` or `resolveSectionSpacing()`. Bottom padding is `pb-14`
(home) or `pb-20` (agent).

- Drop the `HomeCarouselSection` outer `marginBottom`.
- Wide CTA rows use `flex-row items-stretch gap-6 md:gap-8`.

### Design-token CSS (no hand-copied radius)

`@import "@oxyhq/bloom/design-tokens/theme.css"` in
`packages/frontend/styles/global.css`, after the Tailwind import. That provides
`rounded-radius-28`, `p-space-8` and the rest without pasting anything locally.

- **Never declare `--radius-radius-*` or other Bloom scales in `global.css`.** The
  Bloom import is the sole authority.
- Keep only Homiio-local color seeds and `:root` overrides in `global.css`.

## NativeWind: `Pressable` function-form `style`

The NativeWind css-interop (v4 `react-native-css-interop`, and the v5 preview /
`react-native-css` this app now runs) does NOT support React Native's
function-form `style={({ pressed }) => [...]}`. The function is swallowed and the
`Pressable` renders with no style at all.

**Fix:** a static style array plus `onPressIn` / `onPressOut` plus `useState`:

```tsx
const [pressed, setPressed] = useState(false);
<Pressable
  onPressIn={() => setPressed(true)}
  onPressOut={() => setPressed(false)}
  style={[styles.x, pressed && styles.xPressed]}
>
```

- For web hover, use `onHoverIn` / `onHoverOut` plus state instead of
  `({ hovered })`.
- Hooks cannot run inside `.map()`, so extract a small component when a
  function-form `Pressable` lives in a list.
- Canonical template:
  `packages/frontend/components/search/SearchSummaryBar.tsx`.
- **Audit: `packages/frontend/__tests__/noFunctionFormStyle.test.ts`**, which runs
  in the ordinary suite. It replaced `grep -rn "style={({" app components`,
  and the reason is worth keeping: a grep is LINE-based, so it cannot tell code
  from prose, and it started reporting a violation the moment a component's own
  doc comment quoted the forbidden form in order to warn about it. A gate that
  cries wolf gets switched off by whoever hits it next. The test strips comments
  first — through `@homiio/shared-types/testing/stripComments`, the one stripper
  this repo has — and carries a positive control, a negative control (that very
  comment), and a floor on files scanned.

## `pointerEvents: 'box-none'` / `'box-only'` in a STYLE is BROKEN on web

`box-none` and `box-only` are React Native-ONLY values and are NOT valid CSS
`pointer-events`. Put them in a `style` object
(`style={{ pointerEvents: 'box-none' }}`) and RN-Web **silently drops** them,
leaving the element at `pointer-events: auto`, so a transparent, full-size
overlay (a save layer, a scrim wrapper, a padded popover) **swallows every tap
and hover beneath it** with no error. This hid the property-card carousel arrows
and would freeze the whole mobile-web screen behind the closed sidebar drawer
(PR #202 and the box-none sweep).

- **Correct pattern:** split into a pass-through container with
  `pointerEvents: 'none'` (valid CSS) plus genuinely interactive children that
  re-enable themselves with `pointerEvents: 'auto'` (also valid CSS: a child
  `auto` inside a parent `none` IS hittable). That reproduces box-none semantics
  with values RN-Web actually applies.
- The RN `pointerEvents` **PROP** (`<View pointerEvents="box-none">`) is fine,
  because RN-Web maps it correctly. Only the STYLE form is broken. Prefer the
  none/auto split.
- Audit:
  `grep -rn "pointerEvents: 'box-none'\|pointerEvents: 'box-only'" app components`
  should stay ZERO in style objects.

## Masked image zoom (ZoomableImage)

Cards NEVER scale on hover or press ("cutrada"). The app-wide move is the **image
zooming inside the card's rounded mask**: the photo scales, the card stays put,
and corners stay clipped. There is **one** primitive,
`components/ui/ZoomableImage.tsx`.

- Wrap the `<Image>`, not the card:
  `<ZoomableImage borderRadius aspectRatio active style>` renders an
  `overflow:'hidden'` mask around an inner wrapper applying
  `transform:[{scale: active?1.05:1}]`. Overlays (badges, scrim, heart, price)
  stay **siblings of** `ZoomableImage` so they do not zoom.
- **The hover source is the CARD, not the image.** `active` is CONTROLLED first:
  when the caller passes `active` it drives the zoom (external wins) and
  `ZoomableImage` attaches NO hover listeners of its own. Each card owns ONE
  `onPointerEnter` / `onPointerLeave` on web (`onHoverIn` / `onHoverOut` on a
  `Pressable`, or `onPointerEnter` / `onPointerLeave` gated to
  `Platform.OS==='web'` on a plain `View` or `TouchableOpacity`) on its whole
  container, feeding a `hovered` state, and passes `active={hovered || pressed}`
  down, so the photo zooms on hover ANYWHERE on the card, photo or text.
  `onPointerEnter` / `onPointerLeave` fire on the container boundary and do not
  re-fire moving between children on RN-Web, so one handler covers the whole
  card. `pressed` (touch) drives the native zoom. When `active` is omitted,
  `ZoomableImage` falls back to owning its own web hover over the image, for
  standalone use. It is its own component, so there are no hooks in `.map`, and
  it uses static style arrays only.
- The card-level hover must ONLY feed the image `active`. NEVER re-add a
  `transform:[{scale}]`, lift or shadow on the card itself; that is the
  "cutrada" removed in #164.
- For the in-card carousel, thread `imageActive` through
  `PropertyImageCarousel` to each page's `ZoomableImage`, OR-ed with the page's
  own touch press.
- The web transition and the Safari corner-clip fix are baked in (web-cast
  `transitionProperty` and `willChange`, the sanctioned
  `as unknown as ViewStyle` web-CSS pattern). NEVER add a per-component variant;
  reuse this one.
- Wired in: `PropertyImageCarousel` and `PropertyCard` (both paths),
  `CityShowcaseSection`, `Host/AgentCtaBanner`, tips `TipCard`, `RoomList`. Card,
  banner and tile surfaces are otherwise **flat**, with no
  `transform:[{scale}]` card interaction anywhere (audit:
  `grep -rnE "transform.*scale" components app` shows only `ZoomableImage`'s
  image zoom plus genuinely animated worklets).

## Icon button (IconButton)

`components/ui/IconButton.tsx` is the ONE app-wide icon-button primitive: a
circular button with pressed and hover state (static style arrays, no
function-form `style`) and three chrome **variants**. Never hand-roll
`<Pressable style={[barIconButton, pressed && barIconButtonPressed]}><Ionicons/></Pressable>`
again.

- Variants: `ghost` (flat transparent, `mutedSubtle` pressed tint, for headers
  and bars, reusing the shared `barIconButton` / `barIconSize` /
  `barBackIconSize` tokens), `overlay` (frosted white circle for on-photo use,
  such as the card save heart), and `filled` (brand fill plus
  `primaryForeground` glyph). Props: `icon`, `onPress`, `accessibilityLabel`,
  plus optional `variant`, `size`, `color`, `active` and `activeColor`,
  `onLongPress`, `disabled`, `loading`, `badge` and `style`.
- **`SaveButton` is a stateful COMPOSITION of `IconButton`.** It owns save logic
  (mutation, optimistic toggle, count, long-press folder sheet) and passes
  `chrome` to `IconButton`'s `variant` (`ghost` in headers and bars, `overlay` on
  cards). There is no separate cream or shadow save chrome. Every SaveButton site
  inherits the shared button.
- Wired in: `Header` back, `StickyPropertyHeader` back and share, property `[id]`
  floating host/share/viewings (checkmark via `badge`), and `SaveButton`
  everywhere. Future icon-button sites reuse `IconButton`.

## Infinite scroll and pagination primitive

Homiio has **one** reusable infinite-scroll primitive. Never hand-roll
`ScrollView.onScroll` distance math again. It respects the "one scroll owner per
surface" rule above (web sentinel, native handler) rather than copying Mention's
`FlatList.onEndReached`.

- **Web** (document scroll or a nested `overflow:auto`): render
  `components/common/LoadMoreSentinel.tsx` at the list's end, a 1px `View` plus
  `IntersectionObserver` (600px `rootMargin`), inert on native.
- **Native** (the surface's own scroll owner): `hooks/useInfiniteScroll.ts`
  returns an `{ onScroll }` end-detect handler (0.7 threshold, re-arms on scroll
  up) to spread onto the screen's `ScrollView`. The home page instead gets end
  detection from `components/PageScrollView.tsx`'s Reanimated worklet
  (`runOnJS`) firing `onEndReached` and `onEndReachedThreshold`, sharing the same
  `END_REACHED_THRESHOLD` constant.
- A screen wires **both** (sentinel plus native handler), and each platform only
  fires its own. The guarded loader
  (`if (hasNextPage && !isFetchingNextPage) fetchNextPage()`) stays in the
  consumer, not the primitive.
- Canonical data hooks, to reuse rather than writing a new pagination engine:
  `hooks/usePropertySearch.ts` (search, browse, home feed) and
  `hooks/useInfiniteCityProperties.ts` (a city's listings), both
  `useInfiniteQuery`-based and page based. Render results with
  `components/ui/PropertyResultsGrid.tsx` and `PropertyResultsGridSkeleton`, a
  `.map` grid that intentionally does not own scroll, for embedding in the single
  page scroller.
- Wired in: home `app/(tabs)/index.tsx`,
  `components/search/SearchResultsView.tsx`, `app/properties/index.tsx`,
  `app/properties/type/[type].tsx`, `app/properties/city/[id].tsx`.
  `app/(tabs)/saved/index.tsx` does client-side incremental reveal, since there
  is no backend pagination endpoint for it.
- Backend list endpoints feeding an infinite grid should expose flat `hasMore`
  and `totalPages` aliases alongside the nested `pagination` object, which keeps
  `normalizeEnvelope` intact. See `/api/properties/search` and
  `cityController.getPropertiesByCity`.
