import {
  useMutation,
  useQueryClient,
  type MutateOptions,
  type UseMutateAsyncFunction,
  type UseMutateFunction,
} from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { useAccountOwnerGuard } from '@/hooks/useAccountOwner';
import { SavedPropertyChangeSupersededError } from '@/hooks/savedPropertyErrors';

type UpdateNotesVars = { propertyId: string; notes: string };
type CapturedVars = UpdateNotesVars & { operationId: string };
type UpdateNotes = (propertyId: string, notes: string) => Promise<void>;
const capturedOperations = new Map<string, { run: UpdateNotes; unsubscribe: () => void }>();
function release(operationId: string) {
  const operation = capturedOperations.get(operationId);
  if (operation) {
    capturedOperations.delete(operationId);
    operation.unsubscribe();
  }
}

/** Queue serializable variables while retaining the initiating account in memory. */
export function useSavedNotesMutation() {
  const { updateNotes } = useSavedPropertiesContext();
  const { owner, isCurrent } = useAccountOwnerGuard();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ['updateSavedPropertyNotes'],
    mutationFn: async ({ operationId, propertyId, notes }: CapturedVars) => {
      const captured = capturedOperations.get(operationId);
      if (!captured) throw new Error('The account for this operation is no longer available');
      await captured.run(propertyId, notes);
    },
    onSettled: (_data, _error, variables) => {
      release(variables.operationId);
    },
  });
  const capture = (variables: UpdateNotesVars): CapturedVars => {
    const operationId = randomUUID();
    const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== 'removed') return;
      const removed = event.mutation.state.variables as CapturedVars | undefined;
      if (removed?.operationId === operationId) release(operationId);
    });
    capturedOperations.set(operationId, { run: updateNotes, unsubscribe });
    return { ...variables, operationId };
  };
  const callbacks = (options?: MutateOptions<void, Error, UpdateNotesVars>) =>
    options && {
      onSuccess: (
        data: void,
        variables: CapturedVars,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onSuccess>>[3],
      ) =>
        isCurrent(owner) &&
        options.onSuccess?.(
          data,
          { propertyId: variables.propertyId, notes: variables.notes },
          result,
          context,
        ),
      onError: (
        error: Error,
        variables: CapturedVars,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onError>>[3],
      ) =>
        isCurrent(owner) &&
        !(error instanceof SavedPropertyChangeSupersededError) &&
        options.onError?.(
          error,
          { propertyId: variables.propertyId, notes: variables.notes },
          result,
          context,
        ),
      onSettled: (
        data: void | undefined,
        error: Error | null,
        variables: CapturedVars,
        result: unknown,
        context: Parameters<NonNullable<typeof options.onSettled>>[4],
      ) =>
        isCurrent(owner) &&
        !(error instanceof SavedPropertyChangeSupersededError) &&
        options.onSettled?.(
          data,
          error,
          { propertyId: variables.propertyId, notes: variables.notes },
          result,
          context,
        ),
    };
  const mutate: UseMutateFunction<void, Error, UpdateNotesVars> = (variables, options) => {
    mutation.mutate(capture(variables), callbacks(options));
  };
  const mutateAsync: UseMutateAsyncFunction<void, Error, UpdateNotesVars> = (variables, options) =>
    mutation.mutateAsync(capture(variables), callbacks(options));
  const variables = mutation.variables && {
    propertyId: mutation.variables.propertyId,
    notes: mutation.variables.notes,
  };
  return { ...mutation, variables, mutate, mutateAsync };
}
