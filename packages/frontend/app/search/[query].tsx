import { useEffect } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';

export default function SearchQueryScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const query = params.query as string;

    useEffect(() => {
        if (query) {
            // Redirect to the main search screen with the query
            router.replace(`/search?query=${encodeURIComponent(query)}`);
        } else {
            // If no query, redirect to the main search screen
            router.replace('/search');
        }
    }, [query, router]);

    return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" />
        </View>
    );
}
