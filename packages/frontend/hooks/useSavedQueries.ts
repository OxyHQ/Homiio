import { useQuery } from '@tanstack/react-query';
import {
  accountOwnerKey,
  useAccountOwner,
  withAccountOwner,
  type AccountOwner,
} from '@/hooks/useAccountOwner';
import savedPropertyService from '@/services/savedPropertyService';
import savedPropertyFolderService from '@/services/savedPropertyFolderService';

export const savedKeys = {
  properties: (owner: AccountOwner | null) =>
    ['savedProperties', ...accountOwnerKey(owner)] as const,
  folders: (owner: AccountOwner | null) => ['savedFolders', ...accountOwnerKey(owner)] as const,
};

export function useSavedPropertiesQuery(enabled = true) {
  const owner = useAccountOwner();
  return useQuery({
    queryKey: savedKeys.properties(owner),
    queryFn: () =>
      withAccountOwner(owner, savedPropertyService.getSavedProperties.bind(savedPropertyService)),
    enabled: Boolean(owner && enabled),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });
}

export function useSavedFoldersQuery(enabled = true) {
  const owner = useAccountOwner();
  return useQuery({
    queryKey: savedKeys.folders(owner),
    queryFn: () =>
      withAccountOwner(
        owner,
        savedPropertyFolderService.getSavedPropertyFolders.bind(savedPropertyFolderService),
      ),
    enabled: Boolean(owner && enabled),
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 10,
  });
}
