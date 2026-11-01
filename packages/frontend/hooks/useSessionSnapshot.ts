import { useCallback, useSyncExternalStore } from 'react';
import type { OxyServices } from '@oxy.so/core';

/** Observe the session values used to compute a local account projection. */
export function useSessionSnapshot(oxyServices: OxyServices): string {
  const subscribe = useCallback(
    (listener: () => void) => oxyServices.session.onChange(listener),
    [oxyServices],
  );
  const getSnapshot = useCallback(
    () =>
      JSON.stringify([
        oxyServices.http.getSessionEpoch(),
        oxyServices.session.userId,
        Boolean(oxyServices.session.accessToken),
      ]),
    [oxyServices],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
