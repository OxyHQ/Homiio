import React, { useState, useMemo } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { RiCheckLine } from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { Search } from '@oxy.so/bloom/search';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { useColors } from '@/hooks/useThemeColor';
import { spacing } from '@/constants/styles';

interface SearchablePickerBottomSheetProps {
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
  title: string;
  onClose: () => void;
}

/**
 * A filterable single-choice list, presented as bottom-sheet content: a Bloom
 * `Search` over Bloom `Item` rows, with a check on the selected option.
 */
export const SearchablePickerBottomSheet: React.FC<SearchablePickerBottomSheetProps> = ({
  options,
  selected,
  onSelect,
  title,
  onClose,
}) => {
  const { t } = useTranslation();
  const palette = useColors();
  const [search, setSearch] = useState('');
  const filteredOptions = useMemo(
    () => options.filter((opt) => opt.toLowerCase().includes(search.trim().toLowerCase())),
    [options, search],
  );

  return (
    <View style={styles.container}>
      <BloomText style={[styles.title, { color: palette.text }]} accessibilityRole="header">
        {title}
      </BloomText>
      <Search
        label={title}
        placeholder={`${t('common.search')}…`}
        value={search}
        onChangeText={setSearch}
        onClearText={() => setSearch('')}
        autoFocus
      />
      <FlatList
        data={filteredOptions}
        keyExtractor={(item) => item}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const isSelected = item === selected;
          return (
            <Item
              title={item}
              role="option"
              selected={isSelected}
              trailing={isSelected ? <RiCheckLine size="md" fill={palette.primary} /> : undefined}
              accessibilityLabel={item}
              onPress={() => {
                onSelect(item);
                onClose();
              }}
            />
          );
        }}
        ListEmptyComponent={
          <BloomText style={[styles.emptyText, { color: palette.textSecondary }]}>
            {t('common.noResults')}
          </BloomText>
        }
        style={styles.list}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.xl,
    gap: spacing.md,
    flex: 1,
  },
  title: {
    fontWeight: '700',
    fontSize: 18,
  },
  list: {
    flex: 1,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: spacing['2xl'],
  },
});
