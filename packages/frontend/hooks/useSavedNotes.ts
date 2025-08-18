import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import { toast } from 'sonner';

type UpdateNotesVars = { propertyId: string; notes: string };

export function useSavedNotesMutation() {
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['updateSavedPropertyNotes'],
    mutationFn: async ({ propertyId, notes }: UpdateNotesVars) => {
      if (!oxyServices || !activeSessionId) {
        throw new Error('Not authenticated');
      }
      const { userApi } = await import('@/utils/api');
      const res = await userApi.updateSavedPropertyNotes(
        propertyId,
        notes,
        oxyServices,
        activeSessionId,
      );
      return res;
    },
    // Optimistic update to the savedProperties query cache
    onMutate: async ({ propertyId, notes }) => {
      await queryClient.cancelQueries({ queryKey: ['savedProperties'] });

      const previous = queryClient.getQueryData<any>(['savedProperties']);

      if (previous && previous.properties && Array.isArray(previous.properties)) {
        const next = {
          ...previous,
          properties: previous.properties.map((p: any) => {
            const id = p._id || p.id;
            if (id === propertyId) {
              return { ...p, notes };
            }
            return p;
          }),
        };
        queryClient.setQueryData(['savedProperties'], next);
      }

      return { previous } as { previous: any };
    },
    onError: (err: any, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['savedProperties'], context.previous);
      }
      const msg = err?.message || 'Failed to update notes';
      toast.error(msg);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['savedProperties'] });
    },
  });
}

export default useSavedNotesMutation;
