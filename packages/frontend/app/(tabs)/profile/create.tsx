import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxyhq/services';

/** Local multi-profile create removed — use Oxy CreateAccount SDK. */
export default function CreateProfileRedirect() {
  const router = useRouter();
  const { showBottomSheet } = useOxy();

  useEffect(() => {
    showBottomSheet?.('CreateAccount');
    router.replace('/profile');
  }, [showBottomSheet, router]);

  return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator />
    </View>
  );
}
