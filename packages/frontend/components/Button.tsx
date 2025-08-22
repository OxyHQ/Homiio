import { colors } from '@/styles/colors';
import React from 'react';
import { StyleSheet, ViewStyle, TouchableOpacity, Text } from 'react-native';
import { phuduFontWeights } from '@/styles/fonts';

interface ButtonProps {
  onPress: () => void;
  onLongPress?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  style?: ViewStyle;
  backgroundColor?: string;
  textColor?: string;
  accessibilityLabel?: string;
}

const Button: React.FC<ButtonProps> = ({
  onPress,
  onLongPress,
  children,
  disabled = false,
  style,
  backgroundColor,
  textColor,
  accessibilityLabel,
}) => {
  const isSimpleText = typeof children === 'string' || typeof children === 'number';
  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.button, backgroundColor && { backgroundColor }, disabled && styles.disabled, style]}
    >
      {isSimpleText ? (
        <Text style={[styles.buttonText, textColor && { color: textColor }]}>{children}</Text>
      ) : (
        children
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.primaryColor,
    color: colors.primaryLight,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: colors.primaryLight,
    fontSize: 16,
    fontFamily: phuduFontWeights.bold,
    fontWeight: 'bold',
  },
  disabled: {
    opacity: 0.6,
  },
});

export default Button;
