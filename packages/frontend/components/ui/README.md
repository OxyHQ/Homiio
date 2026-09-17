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

## Components

### FilterChip

A selectable chip component for filters and selection.

```tsx
import { FilterChip } from '@/components/ui/FilterChip';

// Basic filter chip
<FilterChip
  label="All Properties"
  selected={filter === 'all'}
  onPress={() => setFilter('all')}
/>

// Disabled chip
<FilterChip
  label="Premium"
  selected={false}
  onPress={() => {}}
  disabled={true}
/>
```

**Props:**

- `label`: string - Chip text
- `selected`: boolean - Whether chip is selected
- `onPress`: () => void - Press handler
- `disabled`: boolean - Whether chip is disabled
- `style`: ViewStyle - Custom styling
- `textStyle`: any - Custom text styling
- `size`: 'small' | 'medium' | 'large' - Chip size

### EmptyState

A component for displaying empty states with optional actions.

```tsx
import { EmptyState } from '@/components/ui/EmptyState';

// Basic empty state
<EmptyState
  icon="folder-open"
  title="No Properties Found"
  description="You haven't added any properties yet."
/>

// With action button
<EmptyState
  icon="add-circle"
  title="No Saved Properties"
  description="Start saving properties to see them here."
  actionText="Browse Properties"
  actionIcon="search"
  onAction={() => router.push('/properties')}
/>
```

**Props:**

- `icon`: string - Icon name (Ionicons)
- `title`: string - Main title text
- `description`: string - Description text
- `actionText`: string - Action button text
- `actionIcon`: string - Action button icon
- `onAction`: () => void - Action button handler
- `style`: ViewStyle - Custom styling
- `iconSize`: number - Icon size
- `iconColor`: string - Icon color

## Usage Examples

### Filter Interface with FilterChips

```tsx
import { FilterChip } from '@/components/ui/FilterChip';

function PropertyFilters({ activeFilter, onFilterChange }) {
  return (
    <View style={styles.filterContainer}>
      <FilterChip
        label="All"
        selected={activeFilter === 'all'}
        onPress={() => onFilterChange('all')}
      />
      <FilterChip
        label="Available"
        selected={activeFilter === 'available'}
        onPress={() => onFilterChange('available')}
      />
      <FilterChip
        label="Rented"
        selected={activeFilter === 'rented'}
        onPress={() => onFilterChange('rented')}
      />
    </View>
  );
}
```

## Best Practices

1. **Consistent Usage**: Use these components consistently across the app for better UX
2. **Accessibility**: All components include proper accessibility features
3. **Responsive Design**: Components adapt to different screen sizes
4. **TypeScript**: All components are fully typed for better development experience
5. **Customization**: Use the style props for custom styling when needed
6. **Performance**: Components are optimized for performance with proper memoization

## Contributing

When adding new UI components:

1. Follow the existing patterns and structure
2. Include comprehensive TypeScript types
3. Add proper documentation and examples
4. Ensure accessibility compliance
5. Test across different screen sizes
6. Update this README with usage examples
