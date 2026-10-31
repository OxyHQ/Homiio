import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useOxy } from '@oxy.so/services/ui/client';
import type { RequestOwner } from '@/utils/api';

export type AccountOwner = RequestOwner & { sessionId: string | null };
const instanceIds = new WeakMap<object, number>();
let nextInstanceId = 1;

/** A non-secret key for this in-memory provider instance and observed account. */
export function accountOwnerKey(owner: AccountOwner | null) {
  if (!owner) return [null, null, null, null] as const;
  let instanceId = instanceIds.get(owner.oxyServices);
  if (instanceId === undefined) {
    instanceId = nextInstanceId++;
    instanceIds.set(owner.oxyServices, instanceId);
  }
  return [owner.userId, owner.sessionId, owner.epoch, instanceId] as const;
}

/** A session id may arrive after the bearer while the same account is restored. */
export function sameAccountProjection(
  previous: AccountOwner | null,
  current: AccountOwner | null,
): boolean {
  return Boolean(
    previous &&
      current &&
      previous.oxyServices === current.oxyServices &&
      previous.userId === current.userId &&
      previous.epoch === current.epoch &&
      (previous.sessionId === current.sessionId || previous.sessionId === null),
  );
}

/** Bind the projected account to the locally observed bearer and session epoch. */
export function useAccountOwner(): AccountOwner | null {
  const { isAuthenticated, user, activeSessionId, oxyServices } = useOxy();
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
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const userId = isAuthenticated ? (user?.id ?? null) : null;
  return useMemo(() => {
    const [epoch, bearerUser, hasToken] = JSON.parse(snapshot) as [number, string | null, boolean];
    if (!userId || !hasToken || bearerUser !== userId) return null;
    return { oxyServices, userId, sessionId: activeSessionId ?? null, epoch };
  }, [oxyServices, userId, activeSessionId, snapshot]);
}

export function assertAccountOwner(owner: AccountOwner | null): asserts owner is AccountOwner {
  if (
    !owner ||
    owner.oxyServices.session.userId !== owner.userId ||
    owner.oxyServices.http.getSessionEpoch() !== owner.epoch
  ) {
    throw new Error('The active account changed');
  }
}

export async function withAccountOwner<T>(
  owner: AccountOwner | null,
  operation: (owner: AccountOwner) => Promise<T>,
): Promise<T> {
  assertAccountOwner(owner);
  const value = await operation(owner);
  assertAccountOwner(owner);
  return value;
}

/** Check UI callbacks against the last committed account and mounted component. */
export function useAccountOwnerGuard() {
  const owner = useAccountOwner();
  const committed = useRef<AccountOwner | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    committed.current = owner;
    return () => {
      if (committed.current === owner) committed.current = null;
    };
  }, [owner]);
  const isCurrent = useCallback((expected: AccountOwner | null): boolean => {
    if (!mounted.current || !sameAccountProjection(expected, committed.current)) return false;
    try {
      assertAccountOwner(expected);
      return true;
    } catch {
      return false;
    }
  }, []);
  return { owner, isCurrent };
}
