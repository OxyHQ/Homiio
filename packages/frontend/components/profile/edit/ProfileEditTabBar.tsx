import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { profileEditStyles as styles } from './styles';
import type { ProfileTab } from './types';

interface ProfileEditTabBarProps {
  tabs: ProfileTab[];
  activeSection: string;
  onSelect: (section: string) => void;
}

export function ProfileEditTabBar({ tabs, activeSection, onSelect }: ProfileEditTabBarProps) {
  return (
    <View style={styles.tabContainer}>
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          style={[styles.tab, activeSection === tab.key && styles.tabActive]}
          onPress={() => onSelect(tab.key)}
        >
          <Text style={[styles.tabText, activeSection === tab.key && styles.tabTextActive]}>
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
