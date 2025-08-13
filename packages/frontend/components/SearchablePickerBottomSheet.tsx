import React, { useState, useMemo } from 'react';
import { View, TextInput, FlatList, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { ThemedText } from './ThemedText';
import { colors } from '@/styles/colors';

interface SearchablePickerBottomSheetProps {
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
  title: string;
  onClose: () => void;
}

export const SearchablePickerBottomSheet: React.FC<SearchablePickerBottomSheetProps> = ({
  options,
  selected,
  onSelect,
  title,
  onClose,
}) => {
  const [search, setSearch] = useState('');
  const filteredOptions = useMemo(
    () => options.filter((opt) => opt.toLowerCase().includes(search.trim().toLowerCase())),
    [options, search],
  );

  return (
    <View style={styles.container}>
      <ThemedText type="subtitle" style={styles.title}>
        {title}
      </ThemedText>
      <TextInput
        style={styles.input}
        placeholder={`Search ${title.toLowerCase()}...`}
        value={search}
        onChangeText={setSearch}
        autoFocus
      />
      <FlatList
        data={filteredOptions}
        keyExtractor={(item) => item}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.option, item === selected && styles.optionSelected]}
            onPress={() => {
              onSelect(item);
              onClose();
            }}
          >
            <Text style={[styles.optionText, item === selected && styles.optionTextSelected]}>
              {item}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No results</Text>}
        style={styles.list}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: colors.COLOR_BACKGROUND,
    flex: 1,
  },
  title: {
    marginBottom: 12,
    fontWeight: 'bold',
    fontSize: 18,
    color: colors.primaryDark,
  },
  input: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    color: colors.primaryDark,
  },
  list: {
    flex: 1,
  },
  option: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_8,
  },
  optionSelected: {
    backgroundColor: colors.primaryLight_2,
  },
  optionText: {
    fontSize: 16,
    color: colors.primaryDark,
  },
  optionTextSelected: {
    color: colors.primaryColor,
    fontWeight: 'bold',
  },
  emptyText: {
    textAlign: 'center',
    color: colors.COLOR_BLACK_LIGHT_4,
    marginTop: 24,
    fontStyle: 'italic',
  },
});
