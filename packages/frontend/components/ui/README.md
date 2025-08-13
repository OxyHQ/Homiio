# Reusable UI Components

This directory contains reusable UI components that can be used across the Homiio app for consistent design and improved development efficiency.

## Components

### StatusBadge

A flexible status badge component that displays status information with icons and colors.

```tsx
import { StatusBadge, type StatusType } from '@/components/ui/StatusBadge';

// Basic usage
<StatusBadge status="active" />

// With custom styling
<StatusBadge
  status="pending"
  size="large"
  showIcon={false}
  customText="Custom Status"
/>
```

**Props:**

- `status`: StatusType - The status to display
- `size`: 'small' | 'medium' | 'large' - Badge size
- `showIcon`: boolean - Whether to show the status icon
- `showText`: boolean - Whether to show the status text
- `style`: ViewStyle - Custom styling
- `customColor`: string - Override the default status color
- `customIcon`: string - Override the default status icon
- `customText`: string - Override the default status text

**Supported Status Types:**

- Contract: `draft`, `pending`, `active`, `expired`, `terminated`
- Payment: `processing`, `completed`, `failed`, `refunded`
- General: `success`, `warning`, `error`, `info`
- Custom: `investigating`, `resolved`, `online`, `offline`

### ActionButton

A versatile button component with multiple variants and states.

```tsx
import { ActionButton, type ActionButtonVariant } from '@/components/ui/ActionButton';

// Primary button
<ActionButton
  icon="add"
  text="Add Item"
  onPress={handleAdd}
/>

// Secondary button with loading state
<ActionButton
  icon="save"
  text="Save"
  onPress={handleSave}
  variant="secondary"
  loading={isSaving}
  disabled={!isValid}
/>
```

**Props:**

- `icon`: string - Icon name (Ionicons)
- `text`: string - Button text
- `onPress`: () => void - Press handler
- `variant`: ActionButtonVariant - Button style variant
- `size`: 'small' | 'medium' | 'large' - Button size
- `disabled`: boolean - Whether button is disabled
- `loading`: boolean - Whether to show loading state
- `style`: ViewStyle - Custom styling
- `iconSize`: number - Custom icon size
- `textStyle`: any - Custom text styling

**Variants:**

- `primary`: Primary brand color
- `secondary`: Secondary/gray color
- `outline`: Outlined style
- `ghost`: Transparent background
- `danger`: Red/danger color

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

### ProgressBar

A progress indicator component with multiple display options.

```tsx
import { ProgressBar } from '@/components/ui/ProgressBar';

// Basic progress bar
<ProgressBar progress={0.75} />

// With labels and percentage
<ProgressBar
  progress={0.6}
  current={6}
  total={10}
  showLabel={true}
  showPercentage={true}
/>

// Custom styling
<ProgressBar
  progress={0.8}
  color="#4CAF50"
  backgroundColor="#E0E0E0"
  height={12}
/>
```

**Props:**

- `progress`: number - Progress value (0 to 1)
- `total`: number - Total count
- `current`: number - Current count
- `showLabel`: boolean - Whether to show label
- `label`: string - Custom label text
- `showPercentage`: boolean - Whether to show percentage
- `color`: string - Progress bar color
- `backgroundColor`: string - Background color
- `height`: number - Bar height
- `style`: ViewStyle - Custom styling
- `labelStyle`: any - Custom label styling

## Usage Examples

### Contract Card with Status Badge

```tsx
import { StatusBadge } from '@/components/ui/StatusBadge';

function ContractCard({ contract }) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{contract.title}</Text>
        <StatusBadge status={contract.status} size="small" />
      </View>
      {/* ... rest of card content */}
    </View>
  );
}
```

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

### Action Buttons in Forms

```tsx
import { ActionButton } from '@/components/ui/ActionButton';

function PropertyForm({ onSubmit, isSubmitting }) {
  return (
    <View style={styles.form}>
      {/* ... form fields */}
      <View style={styles.actions}>
        <ActionButton icon="save" text="Save Draft" onPress={onSaveDraft} variant="outline" />
        <ActionButton
          icon="checkmark"
          text="Publish"
          onPress={onSubmit}
          loading={isSubmitting}
          disabled={!isValid}
        />
      </View>
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
