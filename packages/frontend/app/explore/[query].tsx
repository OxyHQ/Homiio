import { useEffect } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { Loading } from '@oxy.so/bloom/loading';

export default function SearchQueryScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const query = params.query as string;

    useEffect(() => {
        if (query) {
            // Redirect to the main explore screen with the query
            router.replace(`/explore?query=${encodeURIComponent(query)}`);
        } else {
            // If no query, redirect to the main explore screen
            router.replace('/explore');
        }
    }, [query, router]);

    return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Loading size="large" />
        </View>
    );
}
