import React, { useState, useCallback } from 'react';
import { View, TextInput, ViewStyle, Text, TouchableOpacity } from 'react-native';
import LoadingSpinner from './LoadingSpinner';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles/colors';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AnimatedSearchPlaceholder } from './AnimatedSearchPlaceholder';

const debounce = (func: Function, wait: number) => {
  let timeout: NodeJS.Timeout;
  return function executedFunction(...args: any[]) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

interface SearchBarProps {
  hideFilterIcon?: boolean;
}

export const SearchBar = ({ hideFilterIcon = false }: SearchBarProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const router = useRouter();
  const { t } = useTranslation();

  const handleSubmit = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setIsLoading(true);
    try {
      await router.push(`/search/${encodeURIComponent(q)}`);
    } finally {
      setIsLoading(false);
    }
  }, [router, searchQuery]);

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
  };

  return (
    <View
      style={
        {
          backgroundColor: colors.COLOR_BACKGROUND,
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          top: 0,
          zIndex: 1000,
          paddingVertical: 4,
          width: '100%',
          gap: 10,
        } as ViewStyle
      }
    >
      <View
        style={{
          backgroundColor: colors.primaryLight,
          borderRadius: 100,
          height: 45,
          flexDirection: 'row',
          justifyContent: 'flex-start',
          alignItems: 'center',
          paddingStart: 15,
          flex: 1,
          width: '100%',
        }}
      >
        {isLoading ? (
          <LoadingSpinner size={16} color={colors.COLOR_BLACK_LIGHT_4} showText={false} />
        ) : (
          <Ionicons name="search" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
        )}
        <View style={{ flex: 1, marginHorizontal: 17 }}>
          <TextInput
            style={{
              fontSize: 16,
              color: colors.COLOR_BLACK_LIGHT_4,
              width: '100%',
              height: '100%',
              position: 'absolute',
              top: 0,
              left: 0,
            }}
            placeholder=""
            value={searchQuery}
            onChangeText={handleSearchChange}
            returnKeyType="search"
            onSubmitEditing={handleSubmit}
          />
          {!searchQuery && (
            <AnimatedSearchPlaceholder
              style={{
                fontSize: 16,
                color: colors.COLOR_BLACK_LIGHT_4,
                opacity: 0.6,
              }}
            />
          )}
        </View>
        {hideFilterIcon ? (
          <View
            style={{
              padding: 10,
              marginRight: 5,
            }}
          />
        ) : (
          <TouchableOpacity
            onPress={() => setShowFilters(!showFilters)}
            style={{
              padding: 10,
              marginRight: 5,
            }}
          >
            <Ionicons name="options-outline" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
          </TouchableOpacity>
        )}
      </View>

      {showFilters && (
        <View
          style={{
            backgroundColor: colors.primaryLight,
            width: '100%',
            padding: 15,
            borderRadius: 15,
            marginTop: 5,
          }}
        >
          <Text style={{ fontWeight: 'bold', marginBottom: 10 }}>{t('Quick Filters')}</Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <FilterPill label="Eco-friendly" />
            <FilterPill label="Co-living" />
            <FilterPill label="Furnished" />
            <FilterPill label="Pets Allowed" />
            <FilterPill label="< ⊜1000" />
            <FilterPill label="Verified" />
          </View>

          <TouchableOpacity
            style={{
              backgroundColor: colors.primaryColor,
              padding: 10,
              borderRadius: 20,
              alignItems: 'center',
              marginTop: 15,
            }}
            onPress={() => {
              setShowFilters(false);
              router.push('/properties/filter');
            }}
          >
            <Text style={{ color: 'white', fontWeight: '600' }}>{t('Advanced Filters')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const FilterPill = ({ label }: { label: string }) => {
  const [isSelected, setIsSelected] = useState(false);

  return (
    <TouchableOpacity
      style={{
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 20,
        backgroundColor: isSelected ? colors.primaryColor : '#f0f0f0',
        borderWidth: isSelected ? 0 : 1,
        borderColor: '#e0e0e0',
      }}
      onPress={() => setIsSelected(!isSelected)}
    >
      <Text
        style={{
          color: isSelected ? 'white' : colors.COLOR_BLACK_LIGHT_4,
          fontSize: 14,
          fontWeight: isSelected ? '600' : 'normal',
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};
