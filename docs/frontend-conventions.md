# Frontend conventions: layout shell, tokens and the primitives

> Moved out of `AGENTS.md` unchanged. Bloom's own rules live in
> `~/Oxy/Bloom/AGENTS.md`; this is what is true of Homiio's use of them.

## Layout shell and design tokens (CRITICAL)

### The frame is Bloom `AppShell`

`app/_layout.tsx` renders Bloom's `AppShell` the way Noted does, with `<Slot />`
as its content, and nothing else as the frame:

```tsx
<AppShell variant="feed" panel scroll="page" header={null}
  sidebar={…} drawer="reveal" aside={…} bottomBar={<HomiioBottomBar />}>
  <Slot />
</AppShell>
```

**Do not hand-roll a sidebar column, drawer, scrim, bottom bar, right rail,
`ContentPanel`, safe-area padding or breakpoint logic** — the shell owns all of
them, on every platform, with the same code. No `.web.tsx` / `.native.tsx`
layout forks.

- `sidebar` is `useHomiioSidebarProps()` (`components/SideBar`): Bloom `Sidebar`
  PROPS, not a component. The drawer's open state is `uiStore.mobileDrawerOpen`.
- `panel`: every page renders inside the shell's framed `ContentPanel`. A page
  paints no background, card frame or corner of its own.
- `bottomBar` is `components/HomiioBottomBar.tsx` (Bloom `BottomBar`), shown
  while the sidebar is a drawer.
- `aside` is `RightBar`. Decide whether there is a column with
  `useHasRightBar()` BEFORE creating the element: `AppShell` sizes a column for
  any non-null `aside`.
- Device insets belong to Bloom chrome (`PageHeader`, `BottomBar`, `Screen`).
  Pages never use `SafeAreaView` or `useSafeAreaInsets()`; only portaled
  overlays (sheets, dialogs) do.

### A page

Every route is a Bloom `Screen` with its `PageHeader` in the `header` slot and its
content in one `ScreenScrollView` — no background, no other vertical scroller:

```tsx
<Screen
  documentScroll
  header={
    <PageHeader
      title={t('…')}
      titleAlign="center"
      leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
      onBack={router.canGoBack() ? router.back : undefined}
      backLabel={t('goBack')}
    />
  }
  bottomBar={pinnedBar /* only a page with one: BookingBar, a wizard footer */}
>
  <ScreenScrollView contentContainerClassName="gap-4 p-4" onEndReached={loadMore}>
    …
  </ScreenScrollView>
  {/* dialogs and sheets after the scroller */}
</Screen>
```

- Every return branch (loading, error, empty, signed-out) has the same shape, so
  it keeps its header and scrolls.
- A header over a photo (home hero, listing gallery) is
  `PageHeader placement="overlap"`: the content starts at the top edge, under it.
- A pinned bar is `Screen bottomBar`, never `position: 'sticky'`: Bloom pins it
  (sticky on web, absolute on native) on top of the app's bottom navigation and
  reserves its height.
- Content that fills the viewport and scrolls itself (a chat thread, a map) is a
  plain `View` inside `Screen`, with the `PageHeader` in flow above it.

`AppShellMenuButton` renders only while the sidebar is a drawer.

### Scroll ownership

`AppShell scroll="page"`: on web the document scrolls (each `Screen documentScroll`
stays in document flow); on native the shell adds no scroll view and the route's
`ScreenScrollView` is the scroller. A page that renders its content outside a
`ScreenScrollView` does not scroll on native. Horizontal rows and scrollers inside
sheets are fine. `/explore` is the exception: the shell runs `scroll="fixed"`
there, and the results and the map are Bloom's `AppShellSplitPanes` — side by
side with a draggable divider once the panes' own box fits both, one at a time
below that, switched by the Map / List toggle each pane shows while
`useAppShellPaneAlone()`. Explore has no right rail.

### Breakpoints are NativeWind classes

Width-dependent styling is `sm:` / `md:` / `lg:` / `xl:` classes (Bloom's
640 / 768 / 1024 / 1280); something shown only at some widths is hidden with
`hidden md:flex`. No `useWindowDimensions`, `react-responsive` or media-query
hooks.

### Section stacking (NativeWind gap)

Use NativeWind `gap-6 md:gap-8` on the section container, **not** per-section
`marginTop: sectionGap` or `resolveSectionSpacing()`. Bottom padding is `pb-14`
(home) or `pb-20` (agent).

- Wide CTA rows use `flex-row items-stretch gap-6 md:gap-8`.

### Design-token CSS (no hand-copied tokens)

`packages/frontend/styles/global.css` starts with
`@import "@oxy.so/app-preset/css/base.css"`, the same base Inbox and Alia use. It
brings the Tailwind layers, NativeWind's theme, Bloom's design tokens
(`rounded-radius-28`, `p-space-8`, the `--color-*` aliases behind `bg-primary`,
`text-muted-foreground` …) and the SDK `@source` globs. Below it go only
Homiio's own `@source` globs and the web document-scroll override.

- **Never declare a Bloom token in `global.css`** — no `@theme` colour aliases,
  no `--radius-*` scales, no `:root` / `.dark` colour seeds. `BloomProvider`
  injects the base tokens for the active preset and mode at runtime; a seed
  copied here drifts (it once painted the blue preset under a yellow app).
- There is no `tailwind.config.js`: Tailwind v4 reads only the CSS.

### Colours follow the theme

The app follows the system light/dark scheme (`BloomProvider defaultMode="system"`,
persisted; Settings → Appearance overrides it). So no colour is static:

- Text and surfaces use token classes (`text-foreground`, `text-muted-foreground`,
  `text-primary-text`, `bg-card`, `bg-muted`, `border-border`, `bg-success-subtle`
  …). A prop that needs a VALUE (icon `fill`, spinner, gradient) reads
  `useTheme().colors` from `@oxy.so/bloom/theme`.
- No hex literals, no module-scope colour in `StyleSheet.create`, no `+ '20'` alpha
  suffixes (use the `*Subtle` pair or `withAlpha`). Literal white only over photos.
- A Bloom `Text` given a `className` drops its default colour and type style, so
  that className must carry a colour class too.

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
  `packages/frontend/components/ui/PropertyListHeader.tsx`.
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
- Listing cards are the exception: `PropertyCard` is Bloom `ListingCard`
  (paged photos, dots, hover arrows, heart), which draws its own photo track
  and has no image zoom. Do not wrap its photos in `ZoomableImage`.
- The web transition and the Safari corner-clip fix are baked in (web-cast
  `transitionProperty` and `willChange`, the sanctioned
  `as unknown as ViewStyle` web-CSS pattern). NEVER add a per-component variant;
  reuse this one.
- Card, banner and tile surfaces are otherwise **flat**, with no
  `transform:[{scale}]` card interaction anywhere (audit:
  `grep -rnE "transform.*scale" components app` shows only `ZoomableImage`'s
  image zoom plus genuinely animated worklets).

## Icon button (IconButton)

`components/ui/IconButton.tsx` is the ONE app-wide icon-button primitive: a
circular button with pressed and hover state (static style arrays, no
function-form `style`) and three chrome **variants**. Never hand-roll
`<Pressable style={[barIconButton, pressed && barIconButtonPressed]}>` plus a glyph
again.

- Variants: `ghost` (flat transparent, muted pressed tint, for headers and bars), `overlay` (frosted card-coloured circle for on-photo use,
  such as the card save heart), and `filled` (brand fill plus
  `primaryForeground` glyph). Props: `icon` (a Remix icon COMPONENT from
  `@oxy.so/bloom/icons`, e.g. `icon={RiShare2Line}`, never a glyph name),
  `onPress`, `accessibilityLabel`,
  plus optional `variant`, `size`, `color`, `active` and `activeColor`,
  `onLongPress`, `disabled`, `loading`, `badge` and `style`.
- **`SaveButton` is a stateful COMPOSITION of `IconButton`.** It owns save logic
  (mutation, optimistic toggle, count, long-press folder sheet) and passes
  `chrome` to `IconButton`'s `variant` (`ghost` in headers and bars, `overlay` on
  cards). There is no separate cream or shadow save chrome. Every SaveButton site
  inherits the shared button.
- New icon-button sites reuse `IconButton` (a checkmark rides on `badge`).
  Page headers draw their buttons through Bloom `PageHeader` instead.

## Locales load on demand on web

- `locales/*.json` is the only source of truth. **Only `en.json` is bundled**; every other language registers on first use through `setStoredLanguage` / `ensureLanguageLoaded` (`utils/languagePreference.ts`).
- Web fetches `/locales/<file>.json`, which `scripts/publish-web-locales.js` copies into `public/locales/` from `metro.config.js` (gitignored). Native `require`s the file (`utils/localeResources.ts`).
- **Never import a non-English locale JSON in app code** — one static import puts that whole language back into every web page's JavaScript (the twelve bundled locales were ~517 KB gzipped, ~17% of the JS budget). `check:bundle-imports` enforces it.

## Bloom primitives (no local copies)

The local confirm dialog, action button, slider, progress bar and card shells
were removed for their Bloom families. Re-adding a local version is a regression.
The mapping table lives in `packages/frontend/components/ui/README.md`.

- **Import Bloom by family subpath only** (`@oxy.so/bloom/<family>`).
  `bun run check:bundle-imports` fails on the root `'@oxy.so/bloom'` specifier,
  because Metro does not tree-shake and the barrel pulls every family in.
- **Icons are Remix `Ri*Line` / `Ri*Fill` from `@oxy.so/bloom/icons`.** Colour is
  NOT inherited: pass `fill`, or hand the component (not an element) to a Bloom
  control that colours it (`Button leadingIcon`, `Fab icon`).
- **Confirmations are `confirm()` / `alert()` from `@oxy.so/bloom/surfaces`.** The
  press resolves immediately and the surface closes, so the handler shows
  progress and errors with a toast. A dialog that holds a form field (landlord
  notes, host block reason) is a controlled Bloom `Dialog` with `actions`
  (`shouldCloseOnPress: false`, disabled while the mutation runs).
- **Do NOT mount a `SurfaceHost`/`SurfaceProvider` in `app/_layout.tsx`.**
  `OxyProvider` (`@oxy.so/services`) already mounts `SurfaceProvider`, and a
  second host renders every surface twice.
- **Page headers are Bloom `PageHeader`, written in the page** (see "A page"
  above). There is no app header wrapper.
- **A titled row of cards is Bloom `Shelf`** (`@oxy.so/bloom/media-shelf`): it
  owns the heading, "Show all", scrolling, snapping and the web arrows.
- **`AvailabilityCalendar` stays as a listing-rules wrapper over Bloom
  `RangeCalendar`/`Calendar`**: blocked/booked days, min/max stay and the
  no-range-across-unavailable-days rule are Homiio's, not Bloom's.

## Infinite scroll and pagination

A paginated page passes its guarded loader
(`if (hasNextPage && !isFetchingNextPage) fetchNextPage()`) to
`ScreenScrollView onEndReached`. Bloom fires it from the scroll view on native and
from the window in a web `Screen documentScroll`, and re-arms when the content
grows. Never hand-roll scroll distance math or an end-of-list sentinel in a page.
`/explore`'s results list, which scrolls in its own split pane beside the map,
is the one surface with its own `ScrollView`; it pages through `hooks/useInfiniteScroll`, whose
scroll, layout and content-size handlers work the same on web and native.

- Canonical data hooks, to reuse rather than writing a new pagination engine:
  `hooks/usePropertySearch.ts` (search, browse, home feed) and
  `hooks/useInfiniteCityProperties.ts` (a city's listings), both
  `useInfiniteQuery`-based and page based. Render results with
  `components/ui/PropertyResultsGrid.tsx` and `PropertyResultsGridSkeleton`, a
  `.map` grid that intentionally does not own scroll, for embedding in the
  page's `ScreenScrollView`.
- A list with no backend pagination endpoint (saved) reveals client-side a
  page at a time from the same `onEndReached`.
- Backend list endpoints feeding an infinite grid should expose flat `hasMore`
  and `totalPages` aliases alongside the nested `pagination` object, which keeps
  `normalizeEnvelope` intact. See `/api/properties/search` and
  `cityController.getPropertiesByCity`.
