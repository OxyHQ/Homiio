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
}

const Button: React.FC<ButtonProps> = ({
  onPress,
  onLongPress,
  children,
  disabled = false,
  style,
  backgroundColor,
  textColor,
}) => {
  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      style={[
        styles.button,
        backgroundColor && { backgroundColor },
        style,
      ]}
    >
      <Text style={[
        styles.buttonText,
        textColor && { color: textColor },
      ]}>
        {children}
      </Text>
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
});

export default Button;
