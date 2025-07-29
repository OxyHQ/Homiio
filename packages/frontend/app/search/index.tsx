import React, { useState } from 'react';
import { View, TextInput, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {ThemedText} from '@/components/ThemedText';

const mockResults = [
    { id: '1', title: 'Living Room Lights' },
    { id: '2', title: 'Kitchen Thermostat' },
    { id: '3', title: 'Bedroom Fan' },
];

const SearchScreen: React.FC = () => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<typeof mockResults>([]);
    const navigation = useNavigation();

    const handleSearch = (text: string) => {
        setQuery(text);
        // Replace with real search logic
        if (text.length > 0) {
            setResults(
                mockResults.filter(item =>
                    item.title.toLowerCase().includes(text.toLowerCase())
                )
            );
        } else {
            setResults([]);
        }
    };

    const handleSelect = (item: typeof mockResults[0]) => {
        // Navigate or handle selection
        // navigation.navigate('DeviceDetail', { id: item.id });
    };

    return (
        <View style={styles.container}>
            <View style={styles.searchBar}>
                <Ionicons name="search" size={20} color="#888" style={{ marginRight: 8 }} />
                <TextInput
                    style={styles.input}
                    placeholder="Search devices, rooms, scenes..."
                    value={query}
                    onChangeText={handleSearch}
                    autoFocus
                />
            </View>
            <FlatList
                data={results}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                    <TouchableOpacity style={styles.resultItem} onPress={() => handleSelect(item)}>
                        <ThemedText style={styles.resultText}>{item.title}</ThemedText>
                    </TouchableOpacity>
                )}
                ListEmptyComponent={
                    query.length > 0 ? (
                        <ThemedText style={styles.emptyText}>No results found.</ThemedText>
                    ) : null
                }
                keyboardShouldPersistTaps="handled"
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
        backgroundColor: '#fff',
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F2F2F2',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 16,
    },
    input: {
        flex: 1,
        fontSize: 16,
        backgroundColor: 'transparent',
    },
    resultItem: {
        paddingVertical: 14,
        paddingHorizontal: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#E0E0E0',
    },
    resultText: {
        fontSize: 16,
    },
    emptyText: {
        textAlign: 'center',
        color: '#888',
        marginTop: 32,
        fontSize: 16,
    },
});

export default SearchScreen;