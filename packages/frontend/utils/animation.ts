import { Platform } from 'react-native';

/**
 * Whether React Native's `Animated` API should use the native driver.
 *
 * The native animated module only exists on native platforms. On web there is
 * no native driver, so `useNativeDriver: true` warns and falls back to the JS
 * driver. Gate it on the platform so native gets the performance win and web
 * stays warning-free.
 *
 * Note: only applies to RN `Animated`. It is irrelevant to Reanimated, and it
 * must stay `false` for animations of non-native-drivable props (layout, width,
 * height, etc.).
 */
export const USE_NATIVE_DRIVER = Platform.OS !== 'web';
