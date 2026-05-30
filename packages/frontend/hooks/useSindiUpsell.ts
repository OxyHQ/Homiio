import React, { useCallback, useContext } from 'react';
import { useRouter } from 'expo-router';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { FilePremiumInfoSheet } from '@/components/sindi/FilePremiumInfoSheet';

const SUBSCRIPTIONS_ROUTE = '/profile/subscriptions';

export interface UseSindiUpsellResult {
  /** Open the file-analysis premium upsell bottom sheet. */
  openUpsell: () => void;
}

/**
 * Opens the Sindi file-analysis premium upsell sheet and wires its actions
 * (dismiss / upgrade-to-subscriptions). Centralises the bottom-sheet plumbing
 * so the conversation hook only needs a single `openUpsell` callback.
 */
export function useSindiUpsell(): UseSindiUpsellResult {
  const router = useRouter();
  const bottomSheet = useContext(BottomSheetContext);

  const openUpsell = useCallback(() => {
    bottomSheet.openBottomSheet(
      React.createElement(FilePremiumInfoSheet, {
        onClose: () => bottomSheet.closeBottomSheet(),
        onUpgrade: () => {
          bottomSheet.closeBottomSheet();
          router.push(SUBSCRIPTIONS_ROUTE);
        },
      }),
    );
  }, [bottomSheet, router]);

  return { openUpsell };
}
