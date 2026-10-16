import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getData, storeData } from '@/utils/storage';
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

const savedSectionKey = ['local-storage', ACTIVE_SECTION_STORAGE_KEY] as const;

const isPersistableSection = (section: string | null | undefined): section is string =>
  Boolean(section) && (PERSISTABLE_SECTIONS as readonly string[]).includes(section as string);

export function useProfileEditTabs(canPersist: boolean): UseProfileEditTabsResult {
  const queryClient = useQueryClient();
  // The tab the user last left the editor on is an async storage read, so a
  // query loads it; `getData` already turns a read failure into `null`.
  const { data: savedSection } = useQuery({
    queryKey: savedSectionKey,
    queryFn: () => getData<string>(ACTIVE_SECTION_STORAGE_KEY),
    staleTime: Number.POSITIVE_INFINITY,
  });
  // A tab picked on this visit wins; until then the saved one (once loaded).
  const [chosenSection, setChosenSection] = useState<string | null>(null);

  const activeSection =
    chosenSection ?? (isPersistableSection(savedSection) ? savedSection : 'personal');

  const setActiveSection = useCallback(
    (section: string) => {
      setChosenSection(section);
      if (canPersist) {
        queryClient.setQueryData(savedSectionKey, section);
        storeData(ACTIVE_SECTION_STORAGE_KEY, section);
      }
    },
    [canPersist, queryClient],
  );

  return { activeSection, setActiveSection, tabs: PERSONAL_TABS };
}
