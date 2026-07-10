import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxyhq/services';

/** Local trust score UI removed — Oxy TrustCenter SDK. */
export default function TrustScoreRedirect() {
  const router = useRouter();
  const { showBottomSheet } = useOxy();

  useEffect(() => {
    showBottomSheet?.('TrustCenter');
    router.replace('/profile');
  }, [showBottomSheet, router]);

  return null;
}
