import { useCallback } from 'react';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';

type UpdateNotesVars = { propertyId: string; notes: string };

/** The shared saved-properties owner also owns the note's optimistic update. */
export function useSavedNotesMutation() {
  const { updateNotes } = useSavedPropertiesContext();
  const mutateAsync = useCallback(
    ({ propertyId, notes }: UpdateNotesVars) => updateNotes(propertyId, notes),
    [updateNotes],
  );
  return { mutateAsync };
}
