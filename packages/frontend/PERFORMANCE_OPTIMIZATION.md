# Performance Optimization Guide

This guide outlines the performance optimizations implemented across the Homiio app to prevent unnecessary rerenders and improve overall performance.

## Key Optimizations Implemented

### 1. React.memo for Component Memoization

Components that receive props but don't need to rerender when parent rerenders should be wrapped with `React.memo`:

```tsx
// Before
export function MyComponent({ data }) {
  return <div>{data}</div>;
}

// After
export const MyComponent = React.memo(function MyComponent({ data }) {
  return <div>{data}</div>;
});
```

### 2. useMemo for Expensive Computations

Use `useMemo` for expensive calculations, object/array creation, and JSX generation:

```tsx
// Memoize expensive calculations
const expensiveValue = useMemo(() => {
  return heavyComputation(data);
}, [data]);

// Memoize object creation
const config = useMemo(() => ({
  propertyId,
  neighborhoodName,
  city,
  state,
}), [propertyId, neighborhoodName, city, state]);

// Memoize JSX
const widgetContent = useMemo(() => (
  <WidgetManager
    screenId={screenId}
    propertyId={propertyInfo.propertyId}
    neighborhoodName={propertyInfo.neighborhoodName}
  />
), [screenId, propertyInfo]);
```

### 3. useCallback for Event Handlers

Use `useCallback` for event handlers and functions passed as props:

```tsx
const handlePress = useCallback(() => {
  router.push('/profile/edit');
}, [router]);

const handleDataUpdate = useCallback((newData) => {
  setData(newData);
}, []);
```

### 4. Optimized Media Queries

Use the optimized media query hooks to prevent unnecessary rerenders:

```tsx
// Before
const isMobile = useMediaQuery({ maxWidth: 767 });

// After
const isMobile = useIsMobile();
```

Available hooks:
- `useIsMobile()` - maxWidth: 767
- `useIsTablet()` - minWidth: 768, maxWidth: 1023
- `useIsDesktop()` - minWidth: 1024
- `useIsLargeDesktop()` - minWidth: 1440
- `useIsRightBarVisible()` - minWidth: 990
- `useIsScreenNotMobile()` - minWidth: 500

### 5. Context Optimization

Context providers should memoize their values to prevent unnecessary rerenders:

```tsx
const contextValue = useMemo(() => ({
  data,
  loading,
  error,
  refetch,
}), [data, loading, error, refetch]);

return (
  <MyContext.Provider value={contextValue}>
    {children}
  </MyContext.Provider>
);
```

### 6. Performance Monitoring

Use the performance monitoring hooks to track component rerenders:

```tsx
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';

function MyComponent({ data }) {
  usePerformanceMonitor('MyComponent', [data]);
  
  return <div>{data}</div>;
}
```

## Best Practices

### 1. Component Structure

- Keep components small and focused
- Extract reusable logic into custom hooks
- Use composition over inheritance
- Avoid prop drilling by using context or state management

### 2. State Management

- Use Zustand stores for global state
- Keep local state as close to where it's used as possible
- Avoid storing derived state
- Use selectors to access only needed parts of state

### 3. Data Fetching

- Use React Query for server state management
- Implement proper caching strategies
- Use optimistic updates where appropriate
- Handle loading and error states gracefully

### 4. Rendering Optimization

- Use `key` prop correctly in lists
- Avoid inline styles and objects in render
- Use `React.Fragment` instead of unnecessary divs
- Implement virtualization for long lists

### 5. Bundle Optimization

- Use dynamic imports for code splitting
- Lazy load components and routes
- Optimize images and assets
- Use tree shaking effectively

## Performance Monitoring Tools

### 1. Development Tools

- React DevTools Profiler
- Performance Monitor hooks
- Console logging for rerender tracking

### 2. Production Monitoring

- Bundle analyzer
- Performance metrics
- User experience monitoring

## Common Performance Anti-patterns

### ❌ Avoid These

```tsx
// Don't create objects/arrays in render
function BadComponent({ data }) {
  return <div style={{ color: 'red' }}>{data}</div>;
}

// Don't pass new functions on every render
function BadParent() {
  return <Child onPress={() => console.log('clicked')} />;
}

// Don't use inline styles
function BadStyle() {
  return <div style={{ backgroundColor: 'blue', padding: 10 }} />;
}
```

### ✅ Do These Instead

```tsx
// Memoize styles
const styles = useMemo(() => ({
  color: 'red',
}), []);

// Use useCallback for handlers
const handlePress = useCallback(() => {
  console.log('clicked');
}, []);

// Use StyleSheet for styles
const styles = StyleSheet.create({
  container: {
    backgroundColor: 'blue',
    padding: 10,
  },
});
```

## Performance Checklist

Before committing code, ensure:

- [ ] Components that don't need to rerender are memoized
- [ ] Expensive calculations are memoized
- [ ] Event handlers use useCallback
- [ ] Context values are memoized
- [ ] Media queries use optimized hooks
- [ ] No inline objects/arrays in render
- [ ] Proper key props for lists
- [ ] No unnecessary state updates
- [ ] Proper dependency arrays for hooks

## Monitoring Performance

Use the performance monitoring tools to track:

- Component render counts
- Render frequency
- Time between renders
- Function execution times
- Memory usage patterns

This will help identify performance bottlenecks and ensure optimizations are working effectively.
