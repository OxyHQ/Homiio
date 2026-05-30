import { useCallback, useEffect, useMemo, useState } from 'react';
import { getData, storeData } from '@/utils/storage';
import { logger } from '@/utils/logger';
import {
  ACTIVE_SECTION_STORAGE_KEY,
  AGENCY_TABS,
  BUSINESS_TABS,
  COOPERATIVE_TABS,
  PERSISTABLE_SECTIONS,
  PERSONAL_TABS,
  type ProfileTab,
} from '@/components/profile/edit/types';

function defaultSectionFor(profileType: string): string {
  if (profileType === 'agency') return 'business';
  if (profileType === 'cooperative') return 'cooperative';
  return 'personal';
}

function tabsFor(profileType: string): ProfileTab[] {
  if (profileType === 'agency') return AGENCY_TABS;
  if (profileType === 'business') return BUSINESS_TABS;
  if (profileType === 'cooperative') return COOPERATIVE_TABS;
  return PERSONAL_TABS;
}

interface UseProfileEditTabsResult {
  activeSection: string;
  setActiveSection: (section: string) => void;
  tabs: ProfileTab[];
}

/**
 * Owns the active tab for the profile edit screen, including restoring the last
 * tab from storage and persisting it on change.
 *
 * Restoring from AsyncStorage is a genuinely-async side effect, so it stays in
 * an effect keyed on `profileType` (mirroring the original screen, which
 * re-read storage and re-applied the per-type default whenever the resolved
 * profile type changed). Persistence on change happens in the
 * `setActiveSection` event handler instead of a separate effect.
 */
export function useProfileEditTabs(
  profileType: string,
  canPersist: boolean,
): UseProfileEditTabsResult {
  const [activeSection, setActiveSectionState] = useState<string>(() =>
    defaultSectionFor(profileType),
  );

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      try {
        const savedTab = await getData<string>(ACTIVE_SECTION_STORAGE_KEY);
        if (cancelled) return;
        if (savedTab && (PERSISTABLE_SECTIONS as readonly string[]).includes(savedTab)) {
          setActiveSectionState(savedTab);
        } else {
          setActiveSectionState(defaultSectionFor(profileType));
        }
      } catch (error) {
        logger.error('Error loading saved tab state', error);
        if (!cancelled) {
          setActiveSectionState(defaultSectionFor(profileType));
        }
      }
    };

    restore();
    return () => {
      cancelled = true;
    };
  }, [profileType]);

  const setActiveSection = useCallback(
    (section: string) => {
      setActiveSectionState(section);
      if (canPersist) {
        storeData(ACTIVE_SECTION_STORAGE_KEY, section);
      }
    },
    [canPersist],
  );

  const tabs = useMemo(() => tabsFor(profileType), [profileType]);

  return { activeSection, setActiveSection, tabs };
}
