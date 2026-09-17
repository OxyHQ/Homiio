import { shouldPersistSindiTranscript } from '@/hooks/sindiTurnPersistence';

describe('Sindi transcript persistence', () => {
  it('persists a settled, successful turn', () => {
    expect(shouldPersistSindiTranscript({ isLoading: false, error: undefined })).toBe(true);
  });

  it('never persists while a turn streams', () => {
    expect(shouldPersistSindiTranscript({ isLoading: true, error: undefined })).toBe(false);
  });

  it('never persists a failed turn, which would remount the pane and erase its error callout', () => {
    expect(shouldPersistSindiTranscript({ isLoading: false, error: new Error('Sindi chat is temporarily unavailable') })).toBe(false);
  });
});
