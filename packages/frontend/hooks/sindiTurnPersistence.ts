/**
 * Whether the streamed Sindi transcript may be written back to the store.
 *
 * Not while a turn is in flight, and — the part that was a bug — not after a
 * turn FAILED. The AI SDK keeps the unanswered user message on error
 * (`keepLastMessageOnError`), so persisting it grows the stored conversation;
 * every Sindi host keys `ChatContent` on the stored message count, so that write
 * remounted the pane and a fresh `useChat` came up with no error. The chat
 * error callout (and the consent callout) therefore flashed for one render and
 * vanished, and the composer re-enabled as if nothing had happened. A failed
 * turn is not part of the conversation; the retry that succeeds is persisted.
 */
export function shouldPersistSindiTranscript(state: {
  isLoading: boolean;
  error: Error | undefined;
}): boolean {
  return !state.isLoading && state.error === undefined;
}
