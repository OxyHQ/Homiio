import React from 'react';
import { View, Pressable, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@oxyhq/bloom/typography';
import { ChevronRight } from 'lucide-react-native';
import { colors } from '@/styles/colors';

interface FolderRowProps {
  id: string;
  name: string;
  /** Hex color for the folder accent (badge background & icon tint). */
  color: string;
  /** Emoji or short string rendered in the icon square when no thumbs. */
  icon: string;
  propertyCount: number;
  /** Up to two preview thumbnails of properties inside the folder. */
  latestImages?: string[];
}

/**
 * A single saved-folder row in the sidebar. Matches Clarity's folder
 * pattern: rounded-xl row, gap-1.5, 36px height, px-3 horizontal padding,
 * with a 24px icon square on the left and a count + chevron on the right.
 */
export const FolderRow = React.memo(function FolderRow({
  id,
  name,
  color: folderColor,
  icon,
  propertyCount,
  latestImages,
}: FolderRowProps) {
  const router = useRouter();

  const handlePress = React.useCallback(() => {
    router.push(`/saved/${id}`);
  }, [id, router]);

  const hasThumbs = !!latestImages && latestImages.length > 0;
  const tint = folderColor || colors.primaryColor;

  return (
    <View className="group/menu-item relative whitespace-nowrap mx-1">
      <Pressable
        onPress={handlePress}
        className="flex-row items-center gap-1.5 overflow-hidden rounded-xl text-left h-[36px] w-full px-3 py-1.5 hover:bg-muted active:bg-muted/80"
        accessibilityRole="button"
        accessibilityLabel={name}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            overflow: 'hidden',
            backgroundColor: `${tint}20`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {hasThumbs ? (
            <View
              style={{
                flexDirection: 'row',
                width: '100%',
                height: '100%',
              }}
            >
              {latestImages.slice(0, 2).map((url, index) => (
                <View
                  key={`${url}-${index}`}
                  style={{
                    flex: 1,
                    height: '100%',
                    borderRightWidth:
                      index === 0 && latestImages.length > 1 ? 1 : 0,
                    borderRightColor: 'rgba(255,255,255,0.3)',
                  }}
                >
                  <Image
                    source={{ uri: url }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                </View>
              ))}
            </View>
          ) : (
            <Text
              className="select-none"
              style={{ fontSize: 12, color: tint, fontWeight: '600' }}
            >
              {icon}
            </Text>
          )}
        </View>
        <Text
          className="select-none"
          style={{
            flex: 1,
            fontSize: 13,
            color: colors.primaryDark,
            fontWeight: '400',
          }}
          numberOfLines={1}
        >
          {name}
        </Text>
        <Text
          className="select-none"
          style={{
            fontSize: 11,
            color: colors.primaryDark_2,
            marginRight: 4,
          }}
        >
          {propertyCount}
        </Text>
        <ChevronRight size={12} color={colors.primaryDark_2} />
      </Pressable>
    </View>
  );
});
