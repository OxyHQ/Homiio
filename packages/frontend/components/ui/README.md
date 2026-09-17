# Reusable UI Components

This directory contains reusable UI components that can be used across the Homiio app for consistent design and improved development efficiency.

## Bloom first

These primitives were removed in favour of Bloom; do not re-add local copies.

| Need | Use |
|---|---|
| Confirm / alert dialog | `confirm()` / `alert()` from `@oxy.so/bloom/surfaces`; a Bloom `Dialog` with `actions` only when the dialog holds a form |
| Button with icon | `Button` from `@oxy.so/bloom/button` (`leadingIcon={Ri…}`) |
| Slider | `Slider` from `@oxy.so/bloom/slider` |
| Progress bar | `StatBar` from `@oxy.so/bloom/stat-bar` |
| Card surface, thumbnail card, card action row | `Card` / `CardFooter` from `@oxy.so/bloom/card` |
| Horizontal card row | `HomeCarouselSection` (on Bloom `Carousel`) |
| Screen header | `Header` (on Bloom `PageHeader`) |
| Status badge | `Chip` with a data `hue` from `@oxy.so/bloom/chip` (see `ApplicationStatusBadge`, `ContractStatusBadge`) |
| Date / date-range picking | `@oxy.so/bloom/date-picker`; listing availability through `AvailabilityCalendar` |

Import Bloom only through `@oxy.so/bloom/<family>` — `bun run check:bundle-imports`
fails on the root `'@oxy.so/bloom'` specifier.

## Local primitives

Homiio-specific pieces Bloom does not have. Reuse them; do not fork a variant.

- `EmptyState` / `ErrorState`: the one empty and fetch-failure UI for a list or
  grid, in place of inline "Nothing here yet" text. Loading is a skeleton.
- `IconButton`: the one circular icon button (see `docs/frontend-conventions.md`).
- `ZoomableImage`: the one hover/press zoom; the image zooms, never the card.
- `PropertyResultsGrid` / `PropertyResultsGridSkeleton`: a property grid that
  does not own scroll, for the page's single scroller.

### EmptyState

A component for displaying empty states with optional actions.

```tsx
import { RiBookmarkLine, RiFolderOpenLine, RiSearchLine } from '@oxy.so/bloom/icons';
import { EmptyState } from '@/components/ui/EmptyState';

// Basic empty state
<EmptyState
  icon={RiFolderOpenLine}
  title="No Properties Found"
  description="You haven't added any properties yet."
/>

// With action button
<EmptyState
  icon={RiBookmarkLine}
  title="No Saved Properties"
  description="Start saving properties to see them here."
  actionText="Browse Properties"
  actionIcon={RiSearchLine}
  onAction={() => router.push('/properties')}
/>
```

**Props:**

- `icon`: Remix icon component (`@oxy.so/bloom/icons`)
- `title`: string - Main title text
- `description`: string - Description text
- `actionText`: string - Action button text
- `actionIcon`: Remix icon component - Action button icon
- `onAction`: () => void - Action button handler
- `style`: ViewStyle - Custom styling
- `iconSize`: number - Icon size
- `iconColor`: string - Icon color
