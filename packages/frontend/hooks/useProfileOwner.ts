import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useOxy } from '@oxy.so/services/ui/client';
import type { OxyServices } from '@oxy.so/core';

/** A committed local profile owner; this does not establish actor authority. */
export type ProfileOwner = {
  oxyServices: OxyServices;
  userId: string;
  sessionId: string;
  epoch: number;
  revision: number;
  isCurrent: () => boolean;
};

export class ProfileOwnerChangedError extends Error {
  constructor() {
    super('The active account changed');
    this.name = 'ProfileOwnerChangedError';
  }
}

let nextRevision = 0;

/**
 * Homiio mounts one ProfileProvider. Profile reads retain compatibility with
 * a bearer whose subject is unavailable, so this is narrower than the strict
 * action owner: the response subject must also be checked before publication.
 */
export function useProfileOwner(): ProfileOwner | null {
  const { oxyServices, user, activeSessionId, isAuthenticated } = useOxy();
  const subscribe = useCallback(
    (notify: () => void) => oxyServices.session.onChange(notify),
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
  const [epoch, bearerUser, hasToken] = JSON.parse(snapshot) as [number, string | null, boolean];
  const userId = isAuthenticated ? (user?.id ?? null) : null;
  const current = useRef<ProfileOwner | null>(null);
  const [owner, setOwner] = useState<ProfileOwner | null>(null);

  useLayoutEffect(() => {
    if (
      !userId ||
      !activeSessionId ||
      !hasToken ||
      (bearerUser !== null && bearerUser !== userId)
    ) {
      current.current = null;
      setOwner(null);
      return;
    }
    const committed: ProfileOwner = {
      oxyServices,
      userId,
      sessionId: activeSessionId,
      epoch,
      revision: ++nextRevision,
      isCurrent: () => {
        const actualSubject = oxyServices.session.userId;
        return (
          current.current === committed &&
          Boolean(oxyServices.session.accessToken) &&
          oxyServices.http.getSessionEpoch() === epoch &&
          (actualSubject === null || actualSubject === userId)
        );
      },
    };
    current.current = committed;
    setOwner(committed);
    return () => {
      if (current.current === committed) current.current = null;
    };
  }, [oxyServices, userId, activeSessionId, epoch, bearerUser, hasToken]);

  return owner?.oxyServices === oxyServices &&
    owner.userId === userId &&
    owner.sessionId === activeSessionId &&
    owner.isCurrent()
    ? owner
    : null;
}
