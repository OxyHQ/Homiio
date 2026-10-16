import type React from 'react';
import { memo } from 'react';
import { View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { LogoIcon } from '@/assets/logo';
import { Loading } from '@oxy.so/bloom/loading';
import { colors } from '@/styles/colors';
import { LinearGradient, type LinearGradientProps } from 'expo-linear-gradient';
import { styled } from 'nativewind';

interface AppSplashScreenProps {
  onFadeComplete?: () => void;
  startFade?: boolean;
}

// NativeWind 5: `styled` wires `className` → `style` on a third-party component
// once at module scope (the old NW4 per-render `cssInterop` call is gone).
const StyledLinearGradient: React.ComponentType<LinearGradientProps> = styled(LinearGradient, {
  className: 'style',
});

const FADE_DURATION_MS = 500;
const containerStyle = { flex: 1 } as const;
const logoContainerStyle = { alignItems: 'center', justifyContent: 'center' } as const;
const spinnerContainerStyle = { marginTop: 32 } as const;
// Bloom's `info` blue → cream: a fixed semantic token across presets, so the
// splash keeps its signature gradient regardless of the runtime accent.
const gradientColors = [colors.info, colors.secondaryLight] as const;

const AppSplashScreen: React.FC<AppSplashScreenProps> = ({ onFadeComplete, startFade = false }) => {
  // The fade is declared, not triggered: the animated style is a function of
  // `startFade`, and Reanimated runs the 500ms timing the moment it flips to
  // true (and cancels it if the splash unmounts first).
  const fadeStyle = useAnimatedStyle(
    () => ({
      opacity: startFade
        ? withTiming(0, { duration: FADE_DURATION_MS }, (finished) => {
            if (finished && onFadeComplete) runOnJS(onFadeComplete)();
          })
        : 1,
    }),
    [startFade, onFadeComplete],
  );

  return (
    <Animated.View style={[containerStyle, fadeStyle]}>
      <StyledLinearGradient colors={gradientColors} className="flex-1 items-center justify-center">
        <View style={logoContainerStyle}>
          <LogoIcon size={100} color={colors.secondaryColor} />
          <View style={spinnerContainerStyle}>
            <Loading iconSize={28} color={colors.secondaryColor} showText={false} />
          </View>
        </View>
      </StyledLinearGradient>
    </Animated.View>
  );
};

export default memo(AppSplashScreen);
