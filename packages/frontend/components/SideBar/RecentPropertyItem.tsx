import React from 'react';
import { View, Pressable, Image, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@oxyhq/bloom/typography';
import { Home, MoreVertical, Trash2 } from 'lucide-react-native';
import {
  Menu,
  MenuTrigger,
  MenuOptions,
  MenuOption,
  renderers,
} from 'react-native-popup-menu';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';

interface RecentPropertyItemProps {
  id: string;
  title: string;
  /** Optional thumbnail URL. When missing, renders a placeholder square. */
  imageUrl?: string;
  /** Optional secondary line (e.g. neighborhood/city). */
  subtitle?: string;
  isActive: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

/**
 * A single recently-viewed property row in the sidebar. Mirrors Clarity's
 * history-item pattern: a wide pressable on the left with a 36px row
 * height and rounded-xl corners, and a hover-revealed three-dot menu on
 * the right (hidden by default, flex on `group/menu-item:hover`).
 *
 * Adds Homiio-specific richness — a 32px thumbnail and an optional
 * subtitle line — while keeping the same outer layout as Clarity.
 */
export const RecentPropertyItem = React.memo(function RecentPropertyItem({
  id,
  title,
  imageUrl,
  subtitle,
  isActive,
  onSelect,
  onRemove,
}: RecentPropertyItemProps) {
  const router = useRouter();
  const { t } = useTranslation();

  const handlePress = React.useCallback(() => {
    onSelect(id);
    router.push(`/properties/${id}`);
  }, [id, onSelect, router]);

  const handleRemove = React.useCallback(() => {
    onRemove(id);
  }, [id, onRemove]);

  return (
    <View className="group/menu-item relative whitespace-nowrap mx-1">
      <View className="flex-row items-center">
        <Pressable
          onPress={handlePress}
          className={`flex-1 flex-row items-center gap-1.5 overflow-hidden rounded-xl text-left h-[36px] w-full px-3 py-1.5 ${
            isActive ? 'bg-muted' : 'hover:bg-muted active:bg-muted/80'
          }`}
          accessibilityRole="button"
          accessibilityLabel={title}
        >
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              overflow: 'hidden',
              backgroundColor: colors.COLOR_BLACK_LIGHT_7,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {imageUrl ? (
              <Image
                source={{ uri: imageUrl }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            ) : (
              <Home size={12} color={colors.primaryDark_2} />
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              className="select-none"
              style={{
                fontSize: 13,
                color: colors.primaryDark,
                fontWeight: isActive ? '600' : '400',
              }}
              numberOfLines={1}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text
                className="select-none"
                style={{
                  fontSize: 11,
                  color: colors.primaryDark_2,
                }}
                numberOfLines={1}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Menu
          renderer={renderers.Popover}
          rendererProps={{ placement: 'bottom' }}
        >
          <MenuTrigger>
            <View
              className={
                Platform.OS === 'web'
                  ? 'h-6 w-6 hidden group-hover/menu-item:flex items-center justify-center rounded-md shrink-0'
                  : 'h-6 w-6 items-center justify-center rounded-md shrink-0'
              }
            >
              <MoreVertical size={14} color={colors.primaryDark_2} />
            </View>
          </MenuTrigger>
          <MenuOptions
            customStyles={{
              optionsContainer: {
                borderRadius: 8,
                padding: 4,
                minWidth: 180,
              },
            }}
          >
            <MenuOption onSelect={handleRemove}>
              <View className="flex-row items-center gap-2 py-1 px-2">
                <Trash2 size={14} color={colors.busy} />
                <Text style={{ fontSize: 13, color: colors.busy }}>
                  {t('sidebar.recent.remove', {
                    defaultValue: 'Remove from recent',
                  })}
                </Text>
              </View>
            </MenuOption>
          </MenuOptions>
        </Menu>
      </View>
    </View>
  );
});
