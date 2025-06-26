import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { Header } from '@/components/Header';
import { RecentlyViewedTest } from '@/components/RecentlyViewedTest';

export default function RecentlyViewedDebugPage() {
    return (
        <SafeAreaView style={styles.container}>
            <Header options={{ title: 'Recently Viewed Debug', titlePosition: 'center', showBackButton: true }} />
            <RecentlyViewedTest />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
}); 