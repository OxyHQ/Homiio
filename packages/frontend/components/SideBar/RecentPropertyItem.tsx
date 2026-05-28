import React from 'react';
import { View, Pressable, Image, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@oxyhq/bloom/typography';
import { Ionicons } from '@expo/vector-icons';
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
 * A single recently-viewed property row in the sidebar. Mirrors the Clarity
 * history-item pattern: a wide pressable on the left, a hover-revealed
 * three-dot menu on the right that opens a "Remove from recent" action.
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
    <View className="group/recent-item relative whitespace-nowrap mx-1">
      <View className="flex-row items-center">
        <Pressable
          onPress={handlePress}
          className={`flex-1 flex-row items-center gap-2 overflow-hidden rounded-xl w-full px-2 py-1.5 ${
            isActive ? 'bg-muted' : 'hover:bg-muted active:bg-muted/80'
          }`}
        >
          <View
            style={{
              width: 32,
              height: 32,
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
              <Ionicons
                name="home-outline"
                size={14}
                color={colors.primaryDark_2}
              />
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{
                fontSize: 13,
                color: colors.primaryDark,
                fontWeight: isActive ? '600' : '500',
              }}
              numberOfLines={1}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text
                style={{
                  fontSize: 11,
                  color: colors.primaryDark_2,
                  marginTop: 1,
                }}
                numberOfLines={1}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Menu renderer={renderers.Popover} rendererProps={{ placement: 'bottom' }}>
          <MenuTrigger>
            <View
              className={
                Platform.OS === 'web'
                  ? 'h-7 w-7 items-center justify-center rounded-md opacity-0 group-hover/recent-item:opacity-100'
                  : 'h-7 w-7 items-center justify-center rounded-md'
              }
            >
              <Ionicons
                name="ellipsis-vertical"
                size={14}
                color={colors.primaryDark_2}
              />
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
                <Ionicons
                  name="trash-outline"
                  size={14}
                  color={colors.busy}
                />
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
