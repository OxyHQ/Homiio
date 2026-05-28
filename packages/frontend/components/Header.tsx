import React, { useEffect, useState, ReactNode } from 'react';
import { StyleSheet, View, ViewStyle, Platform, Pressable } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from './ThemedText';
import { useLayoutScroll } from '@/context/LayoutScrollContext';

interface Props {
  style?: ViewStyle;
  options?: {
    title?: string;
    titlePosition?: 'left' | 'center';
    subtitle?: string;
    showBackButton?: boolean;
    leftComponents?: ReactNode[];
    rightComponents?: ReactNode[];
    transparent?: boolean;
    scrollThreshold?: number;
  };
  scrollY?: SharedValue<number>;
}

export const Header: React.FC<Props> = ({ options, scrollY: externalScrollY }) => {
  const layoutScroll = useLayoutScroll();
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);
  const insets = useSafeAreaInsets();
  const internalScrollY = useSharedValue(0);
  const scrollY = externalScrollY ?? layoutScroll?.scrollY ?? internalScrollY;

  const titlePosition = options?.titlePosition || 'left';
  const isTransparent = options?.transparent || false;
  const scrollThreshold = options?.scrollThreshold || 20;

  useEffect(() => {
    setCanGoBack(router.canGoBack());
  }, [router]);

  useEffect(() => {
    if (Platform.OS !== 'web' || externalScrollY || layoutScroll?.scrollY) return;
    const handleScroll = () => {
      scrollY.value = window.scrollY;
    };
    document.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      document.removeEventListener('scroll', handleScroll);
    };
  }, [scrollY, externalScrollY, layoutScroll]);

  const backgroundStyle = useAnimatedStyle(() => {
    if (!isTransparent) {
      return { opacity: 1, shadowOpacity: 0.1, elevation: 3 };
    }
    const progress = interpolate(
      scrollY.value,
      [0, scrollThreshold],
      [0, 1],
      'clamp',
    );
    return {
      opacity: progress,
      shadowOpacity: interpolate(
        scrollY.value,
        [0, scrollThreshold],
        [0, 0.1],
        'clamp',
      ),
      elevation: interpolate(
        scrollY.value,
        [0, scrollThreshold],
        [0, 3],
        'clamp',
      ),
    };
  });

  return (
    <View style={[styles.topRow, { minHeight: 60 + insets.top }]}>
      {/* Animated Background */}
      <Animated.View
        style={[
          styles.backgroundOverlay,
          {
            backgroundColor: colors.primaryLight,
            shadowColor: colors.COLOR_BLACK,
            shadowOffset: {
              width: 0,
              height: 2,
            },
            shadowRadius: 3,
            borderBottomWidth: 0.01,
            borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
          },
          backgroundStyle,
        ]}
      />

      {/* Header Content - Always Visible */}
      <View style={[styles.contentContainer, { paddingTop: insets.top }]}>
        <View style={styles.leftContainer}>
          {options?.showBackButton && canGoBack && (
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color={colors.COLOR_BLACK} />
            </Pressable>
          )}
          {options?.leftComponents?.map((component, index) => (
            <React.Fragment key={index}>{component}</React.Fragment>
          ))}
          {titlePosition === 'left' && (
            <View>
              {options?.title && (
                <ThemedText
                  style={[
                    styles.topRowText,
                    options?.subtitle && { fontSize: 14 },
                  ]}
                >
                  {options.title}
                </ThemedText>
              )}
              {options?.subtitle && (
                <ThemedText style={styles.subtitleText}>{options.subtitle}</ThemedText>
              )}
            </View>
          )}
        </View>
        {titlePosition === 'center' && (
          <View style={styles.centerContainer}>
            {options?.title && (
              <ThemedText
                style={[
                  styles.topRowText,
                  options?.subtitle && { fontSize: 14 },
                ]}
              >
                {options.title}
              </ThemedText>
            )}
            {options?.subtitle && (
              <ThemedText style={styles.subtitleText}>{options.subtitle}</ThemedText>
            )}
          </View>
        )}
        <View style={styles.rightContainer}>
          {options?.rightComponents?.map((component, index) => (
            <React.Fragment key={index}>{component}</React.Fragment>
          ))}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingBottom: 10,
  },
  topRow: {
    ...Platform.select({
      web: {
        position: 'sticky',
        top: 0,
        zIndex: 1000,
      },
      default: {
        position: 'relative',
        zIndex: 100,
      },
    }),
  } as ViewStyle,
  backgroundOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    ...Platform.select({
      web: {
        backdropFilter: 'blur(10px)',
      },
    }),
  },
  contentContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingTop: Platform.select({
      web: 5,
      default: 12,
    }),
    paddingBottom: Platform.select({
      web: 5,
      default: 4,
    }),
    position: 'relative',
    elevation: 5,
    ...Platform.select({
      web: {
        minHeight: 60,
      },
    }),
  },
  topRowText: {
    fontSize: 20,
    color: colors.COLOR_BLACK,
    fontWeight: '800',
    paddingStart: 1,
  },
  subtitleText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontWeight: '400',
  },
  startContainer: {
    borderRadius: 100,
    padding: 10,
  },
  backButton: {
    marginRight: 10,
  },
  leftContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
    gap: 10,
  },
  stickyHeader: {
    borderTopEndRadius: 0,
    borderTopStartRadius: 0,
  },
});
