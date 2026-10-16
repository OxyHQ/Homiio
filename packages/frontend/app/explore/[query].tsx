import { Redirect, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { Loading } from '@oxy.so/bloom/loading';

/** `/explore/<query>` — a legacy path, redirected to the explore screen. */
export default function SearchQueryScreen() {
  const params = useLocalSearchParams();
  const query = params.query as string;
  const href = query ? `/explore?query=${encodeURIComponent(query)}` : '/explore';

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Redirect href={href} />
      <Loading size="lg" />
    </View>
  );
}
