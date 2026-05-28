import React from 'react';
import { View, Pressable, Platform } from 'react-native';
import { Text } from '@oxyhq/bloom/typography';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface NavItemProps {
  /** Ionicons name for the inactive state. */
  icon: IoniconName;
  /** Optional Ionicons name for the active state — falls back to `icon`. */
  iconActive?: IoniconName;
  /** Item label (also used as accessibility label when collapsed). */
  label: string;
  onPress: () => void;
  /** Keyboard shortcut hint, shown on web hover (e.g. "Ctrl+K"). */
  shortcut?: string;
  isActive?: boolean;
  /** Render the 40x40 icon-only rail variant. */
  collapsed?: boolean;
}

/**
 * Sidebar navigation row. Two variants:
 *   - collapsed: 40x40 rounded square with the icon centered
 *   - expanded: full-width row with icon + label + optional keyboard shortcut
 *
 * Mirrors Clarity's nav-item structure exactly: `group/menu-item` for the
 * hover-revealed shortcut, `border border-transparent` for the active-ring
 * placeholder, and a 36px row height with rounded-xl corners.
 */
export const NavItem = React.memo(function NavItem({
  icon,
  iconActive,
  label,
  onPress,
  shortcut,
  isActive,
  collapsed,
}: NavItemProps) {
  const iconName = isActive ? (iconActive ?? icon) : icon;
  const iconColor = isActive ? colors.primaryColor : colors.primaryDark;

  if (collapsed) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityLabel={label}
        accessibilityRole="button"
        className={`group/nav-icon w-10 h-10 rounded-xl items-center justify-center ${
          isActive ? 'bg-muted' : 'hover:bg-muted active:bg-muted/80'
        }`}
      >
        <Ionicons name={iconName} size={20} color={iconColor} />
      </Pressable>
    );
  }

  return (
    <View className="relative flex w-full min-w-0 flex-col px-1.5 py-0.5 shrink-0">
      <View className="flex w-full min-w-0 flex-col gap-px">
        <View className="group/menu-item whitespace-nowrap font-semibold mx-1 relative">
          <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={label}
            className={`flex-row items-center gap-2 overflow-hidden rounded-xl text-left h-[36px] border border-transparent w-full gap-1 p-1.5 ${
              isActive ? 'bg-muted' : 'hover:bg-muted active:bg-muted/80'
            }`}
          >
            <View className="w-6 h-6 flex items-center justify-center shrink-0">
              <Ionicons name={iconName} size={18} color={iconColor} />
            </View>
            <Text
              className="select-none"
              style={{
                fontSize: 14,
                fontWeight: '600',
                color: isActive ? colors.primaryColor : colors.primaryDark,
                flex: 1,
              }}
              numberOfLines={1}
            >
              {label}
            </Text>
            {shortcut && Platform.OS === 'web' && (
              <View className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 group-hover/menu-item:opacity-100">
                <Text
                  className="select-none"
                  style={{
                    fontSize: 11,
                    color: colors.primaryDark_2,
                    marginRight: 8,
                  }}
                >
                  {shortcut}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
});
