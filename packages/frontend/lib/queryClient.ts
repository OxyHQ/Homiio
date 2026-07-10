import { QueryClient } from '@tanstack/react-query';

/** Singleton QueryClient shared with OxyProvider SDK hooks. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
    },
  },
});
