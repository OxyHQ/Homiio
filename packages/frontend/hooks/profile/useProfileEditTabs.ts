import { useCallback, useEffect, useMemo, useState } from 'react';
import { getData, storeData } from '@/utils/storage';
import { logger } from '@/utils/logger';
import {
  ACTIVE_SECTION_STORAGE_KEY,
  PERSISTABLE_SECTIONS,
  PERSONAL_TABS,
  type ProfileTab,
} from '@/components/profile/edit/types';

interface UseProfileEditTabsResult {
  activeSection: string;
  setActiveSection: (section: string) => void;
  tabs: ProfileTab[];
}

export function useProfileEditTabs(canPersist: boolean): UseProfileEditTabsResult {
  const [activeSection, setActiveSectionState] = useState<string>('personal');

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      try {
        const savedTab = await getData<string>(ACTIVE_SECTION_STORAGE_KEY);
        if (cancelled) return;
        if (savedTab && (PERSISTABLE_SECTIONS as readonly string[]).includes(savedTab)) {
          setActiveSectionState(savedTab);
        } else {
          setActiveSectionState('personal');
        }
      } catch (error) {
        logger.error('Error loading saved tab state', error);
        if (!cancelled) {
          setActiveSectionState('personal');
        }
      }
    };

    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const setActiveSection = useCallback(
    (section: string) => {
      setActiveSectionState(section);
      if (canPersist) {
        storeData(ACTIVE_SECTION_STORAGE_KEY, section);
      }
    },
    [canPersist],
  );

  const tabs = useMemo(() => PERSONAL_TABS, []);

  return { activeSection, setActiveSection, tabs };
}
