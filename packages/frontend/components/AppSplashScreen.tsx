import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { View, Animated } from 'react-native';
import { LogoIcon } from '@/assets/logo';
import { Loading } from '@oxyhq/bloom/loading';
import { colors } from '@/styles/colors';
import { USE_NATIVE_DRIVER } from '@/utils/animation';
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

const AppSplashScreen: React.FC<AppSplashScreenProps> = ({ onFadeComplete, startFade = false }) => {
  // Lazy-init keeps a single Animated.Value across renders without reading a
  // ref during render (which the React Compiler / react-hooks rules forbid).
  const [fadeAnim] = useState(() => new Animated.Value(1));
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  // Memoize the fade completion callback to prevent recreating it
  const handleFadeComplete = useCallback(
    (finished: boolean) => {
      if (finished && onFadeComplete) {
        onFadeComplete();
      }
    },
    [onFadeComplete],
  );

  useEffect(() => {
    if (startFade) {
      // Cancel any existing animation
      if (animationRef.current) {
        animationRef.current.stop();
      }

      // Start fade out immediately when startFade becomes true, taking 500ms to complete
      animationRef.current = Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: USE_NATIVE_DRIVER,
      });

      animationRef.current.start(({ finished }) => {
        handleFadeComplete(finished);
      });
    }

    // Cleanup function to stop animation if component unmounts
    return () => {
      if (animationRef.current) {
        animationRef.current.stop();
      }
    };
  }, [startFade, fadeAnim, handleFadeComplete]);

  // Memoize styles to prevent recreation on every render
  const containerStyle = useMemo(() => ({ flex: 1, opacity: fadeAnim }), [fadeAnim]);
  const logoContainerStyle = useMemo(
    () => ({ alignItems: 'center' as const, justifyContent: 'center' as const }),
    [],
  );
  const spinnerContainerStyle = useMemo(() => ({ marginTop: 32 }), []);

  // Memoize gradient colors to prevent array recreation. The splash keeps its
  // signature blue→cream gradient (with the gold logo/spinner) via Bloom's
  // `info` blue — a fixed semantic token across presets, so it's NOT tied to
  // the runtime accent (now the yellow primary).
  const gradientColors = useMemo(() => [colors.info, colors.secondaryLight] as const, []);

  return (
    <Animated.View style={containerStyle}>
      <StyledLinearGradient
        colors={gradientColors}
        className="flex-1 items-center justify-center"
      >
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

export default React.memo(AppSplashScreen);
