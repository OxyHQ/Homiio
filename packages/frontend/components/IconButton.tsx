import React from 'react';
import { TouchableOpacity, ViewStyle, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';

type IconButtonProps = {
  name: string;
  size?: number;
  color?: string;
  backgroundColor?: string;
  style?: ViewStyle;
  onPress?: () => void;
};

export function IconButton({
  name,
  size = 24,
  color = colors.primaryColor,
  backgroundColor = colors.primaryLight_1,
  style,
  onPress,
}: IconButtonProps) {
  return (
    <TouchableOpacity style={[styles.container, { backgroundColor }, style]} onPress={onPress}>
      <Ionicons name={name as any} size={size} color={color} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
