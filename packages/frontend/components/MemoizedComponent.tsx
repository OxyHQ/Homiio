import React from 'react';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';

/**
 * Higher-order component that wraps a component with React.memo and performance monitoring
 * Use this to easily optimize components and track their rerenders
 */
export function withMemoization<T extends object>(
    Component: React.ComponentType<T>,
    componentName?: string,
    arePropsEqual?: (prevProps: T, nextProps: T) => boolean
) {
    const MemoizedComponent = React.memo(Component, arePropsEqual);

    const WrappedComponent = (props: T) => {
        const name = componentName || Component.displayName || Component.name || 'Unknown';
        usePerformanceMonitor(name, Object.values(props));

        return <MemoizedComponent {...props} />;
    };

    WrappedComponent.displayName = `Memoized(${componentName || Component.displayName || Component.name})`;

    return WrappedComponent;
}

/**
 * Hook to create a memoized callback that only changes when dependencies change
 * This is a wrapper around useCallback with performance monitoring
 */
export function useMemoizedCallback<T extends (...args: any[]) => any>(
    callback: T,
    dependencies: React.DependencyList,
    callbackName?: string
): T {
    const memoizedCallback = React.useCallback(callback, dependencies);

    React.useEffect(() => {
        if (__DEV__) {
            console.log(`🔄 Memoized callback "${callbackName || 'anonymous'}" updated`);
        }
    }, [memoizedCallback, callbackName]);

    return memoizedCallback;
}

/**
 * Hook to create a memoized value that only changes when dependencies change
 * This is a wrapper around useMemo with performance monitoring
 */
export function useMemoizedValue<T>(
    factory: () => T,
    dependencies: React.DependencyList,
    valueName?: string
): T {
    const memoizedValue = React.useMemo(() => factory(), dependencies);

    React.useEffect(() => {
        if (__DEV__) {
            console.log(`🔄 Memoized value "${valueName || 'anonymous'}" updated`);
        }
    }, [memoizedValue, valueName]);

    return memoizedValue;
}
