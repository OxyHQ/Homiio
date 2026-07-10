import { useCallback } from 'react';
import { useOxy } from '@oxyhq/services';

/** @deprecated Local trust score removed — use showBottomSheet('TrustCenter'). */
export function useTrustScore() {
  const { showBottomSheet } = useOxy();

  const openTrustCenter = useCallback(() => {
    showBottomSheet?.('TrustCenter');
  }, [showBottomSheet]);

  return {
    trustScore: null,
    factors: [] as Array<{ type: string; value: number; label?: string }>,
    isLoading: false,
    error: null,
    recalculate: openTrustCenter,
    updateFactor: openTrustCenter,
    openTrustCenter,
  };
}
