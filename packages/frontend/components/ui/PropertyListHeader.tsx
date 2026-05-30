/**
 * PropertyListHeader — the flat, app-consistent header used by every
 * property-list surface that isn't the full search/browse experience
 * (Recently viewed, My properties, Drafts, Type results).
 *
 * Mirrors the language of the `/properties` top bar (see
 * `app/properties/index.tsx`): a flat `surfaceElevated` bar with a single
 * hairline divider — no heavy shadow — that clears the status bar itself via
 * `useSafeAreaInsets`, and clamps its content to the same max width so the
 * title lines up with the grid below on wide screens.
 *
 * It is intentionally simpler than the global `Header`: no Reanimated scroll
 * fade, no `ThemedText`. Just a back button, a Bloom `H4` title (with an
 * optional one-line subtitle), and a right-hand action slot for owner actions
 * (e.g. "Add property").
 */
import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { H4, Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { contentClamp, hairline, radius, spacing } from '@/constants/styles';

/** Size of the circular back/icon button tap target. */
const ICON_BUTTON_SIZE = 40;

interface PropertyListHeaderProps {
  /** Main title shown next to the back button. */
  title: string;
  /** Optional one-line subtitle below the title (e.g. result count). */
  subtitle?: string;
  /**
   * Show the leading back button. Defaults to `true`. The button only
   * navigates when there is history to pop.
   */
  showBack?: boolean;
  /** Optional trailing action(s) — owner buttons, clear, etc. */
  right?: React.ReactNode;
  /** Extra style for the outer bar (rarely needed). */
  style?: StyleProp<ViewStyle>;
}

/** A circular, NativeWind-safe icon button (static style + pressed state). */
function HeaderIconButton({
  icon,
  onPress,
  accessibilityLabel,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const [pressed, setPressed] = React.useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.iconButton, pressed && styles.iconButtonPressed]}
    >
      <Ionicons name={icon} size={22} color={colors.COLOR_BLACK} />
    </Pressable>
  );
}

export const PropertyListHeader: React.FC<PropertyListHeaderProps> = ({
  title,
  subtitle,
  showBack = true,
  right,
  style,
}) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleBack = React.useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    }
  }, [router]);

  return (
    <View style={[styles.bar, { paddingTop: insets.top }, style]}>
      <View style={styles.content}>
        {showBack ? (
          <HeaderIconButton
            icon="chevron-back"
            onPress={handleBack}
            accessibilityLabel="Go back"
          />
        ) : null}
        <View style={styles.titleColumn}>
          <H4 style={styles.title} numberOfLines={1}>
            {title}
          </H4>
          {subtitle ? (
            <BloomText style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </BloomText>
          ) : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: Platform.select<ViewStyle>({
    web: {
      position: 'sticky',
      top: 0,
      zIndex: 100,
      backgroundColor: colors.surfaceElevated,
      borderBottomWidth: hairline.width,
      borderBottomColor: hairline.color,
    } as unknown as ViewStyle,
    default: {
      backgroundColor: colors.surfaceElevated,
      borderBottomWidth: hairline.width,
      borderBottomColor: hairline.color,
    },
  }) as ViewStyle,
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    maxWidth: contentClamp.page,
    width: '100%',
    alignSelf: 'center',
  },
  titleColumn: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  subtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginTop: 2,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconButton: {
    width: ICON_BUTTON_SIZE,
    height: ICON_BUTTON_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPressed: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
});

export default PropertyListHeader;
