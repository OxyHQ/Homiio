# SectionCard Component

A reusable card component for property sections that provides consistent styling and layout.

## Usage

```tsx
import { SectionCard } from '@/components/ui/SectionCard';

// Basic usage with title
<SectionCard title="Property Features">
  <YourContent />
</SectionCard>

// Custom styling
<SectionCard 
  title="Amenities"
  cardStyle={{ backgroundColor: '#f8f9fa' }}
  titleStyle={{ color: '#333' }}
  padding={20}
  borderRadius={16}
>
  <YourContent />
</SectionCard>

// Without title
<SectionCard>
  <YourContent />
</SectionCard>

// Without shadow
<SectionCard title="Details" showShadow={false}>
  <YourContent />
</SectionCard>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | `undefined` | Optional title to display above the card |
| `children` | `React.ReactNode` | **Required** | Content to render inside the card |
| `containerStyle` | `ViewStyle` | `undefined` | Additional styling for the container |
| `cardStyle` | `ViewStyle` | `undefined` | Additional styling for the card itself |
| `titleStyle` | `ViewStyle` | `undefined` | Additional styling for the title |
| `showShadow` | `boolean` | `true` | Whether to show the card shadow/elevation |
| `padding` | `number` | `16` | Custom padding for the card content |
| `borderRadius` | `number` | `12` | Custom border radius for the card |
| `marginBottom` | `number` | `20` | Custom margin bottom for the container |

## Features

- Consistent styling across all property sections
- Configurable shadow and elevation
- Responsive design
- TypeScript support
- Flexible styling options

## Migration from Legacy Components

### Before (PropertyFeatures.tsx)
```tsx
return (
  <View style={styles.container}>
    <ThemedText style={styles.title}>{t('Property Features')}</ThemedText>
    <View style={styles.card}>
      <YourContent />
    </View>
  </View>
);

const styles = StyleSheet.create({
  container: { marginBottom: 20 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  card: {
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e9ecef',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
});
```

### After
```tsx
return (
  <SectionCard title={t('Property Features')}>
    <YourContent />
  </SectionCard>
);

// Only keep content-specific styles
const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  // ... other content styles
});
```

## Updated Components

The following components have been updated to use `SectionCard`:

- ✅ `PropertyFeatures.tsx`
- ✅ `PropertyDetailsCard.tsx` 
- ✅ `AmenitiesSection.tsx`
- ✅ `NeighborhoodInfo.tsx`
- ✅ `AvailabilitySection.tsx`
- ✅ `BasicInfoSection.tsx` (description card)
- ✅ `LandlordSection.tsx` (main card wrapper)
- ✅ `PropertyStatistics.tsx` → **Renamed to `PropertyOverview.tsx`**

## Component Renames

- `PropertyStatistics` → `PropertyOverview` (better reflects its purpose of showing basic property info)

## Potential Components for Migration

The following components could still benefit from using `SectionCard`:

- `PricingDetails.tsx`
- `HouseRules.tsx`
- `LocationSection.tsx` (address and amenities cards)
