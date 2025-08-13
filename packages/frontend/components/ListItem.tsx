import React, { ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { IconButton } from './IconButton';

type ListItemProps = {
  title: string;
  icon?: string;
  onPress?: () => void;
  rightElement?: ReactNode;
  style?: ViewStyle;
  description?: string;
  showChevron?: boolean;
};

export function ListItem({
  title,
  icon,
  onPress,
  rightElement,
  style,
  description,
  showChevron = true,
}: ListItemProps) {
  return (
    <TouchableOpacity style={[styles.container, style]} onPress={onPress} disabled={!onPress}>
      <View style={styles.leftContent}>
        {icon && <IconButton name={icon} style={styles.icon} />}
        <View style={styles.textContainer}>
          <Text style={styles.title}>{title}</Text>
          {description && <Text style={styles.description}>{description}</Text>}
        </View>
      </View>
      <View style={styles.rightContent}>
        {rightElement}
        {showChevron && onPress && (
          <Ionicons
            name="chevron-forward"
            size={24}
            color={colors.primaryDark_1}
            style={styles.chevron}
          />
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryLight_1,
  },
  leftContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  icon: {
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    color: colors.primaryDark,
    fontWeight: '400',
  },
  description: {
    fontSize: 14,
    color: colors.primaryDark_1,
    marginTop: 2,
  },
  rightContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chevron: {
    marginLeft: 8,
  },
});
