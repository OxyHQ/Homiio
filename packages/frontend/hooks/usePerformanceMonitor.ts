import { useEffect, useRef } from 'react';

/**
 * Hook to monitor component rerenders for performance debugging
 * Only active in development mode
 */
export function usePerformanceMonitor(componentName: string, dependencies?: any[]) {
  const renderCount = useRef(0);
  const lastRenderTime = useRef(Date.now());

  useEffect(() => {
    if (__DEV__) {
      renderCount.current += 1;
      const now = Date.now();
      const timeSinceLastRender = now - lastRenderTime.current;
      lastRenderTime.current = now;

      console.log(
        `🔄 ${componentName} rendered #${renderCount.current} (${timeSinceLastRender}ms since last render)`,
        dependencies ? `Dependencies: ${JSON.stringify(dependencies)}` : ''
      );
    }
  });

  // Log when component unmounts
  useEffect(() => {
    return () => {
      if (__DEV__) {
        console.log(`🗑️ ${componentName} unmounted after ${renderCount.current} renders`);
      }
    };
  }, [componentName]);

  return renderCount.current;
}

/**
 * Hook to measure function execution time
 */
export function usePerformanceTimer() {
  const timers = useRef<Map<string, number>>(new Map());

  const startTimer = (name: string) => {
    if (__DEV__) {
      timers.current.set(name, performance.now());
    }
  };

  const endTimer = (name: string) => {
    if (__DEV__) {
      const startTime = timers.current.get(name);
      if (startTime) {
        const duration = performance.now() - startTime;
        console.log(`⏱️ ${name} took ${duration.toFixed(2)}ms`);
        timers.current.delete(name);
      }
    }
  };

  return { startTimer, endTimer };
}
