import React from 'react';
import { View, Text, Platform } from 'react-native';
import { Pressable } from 'react-native-web-hover';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';

export function SideBarItem({
  isActive,
  icon,
  text,
  href,
  isExpanded,
  onHoverExpand,
  onPress,
}: {
  isActive: boolean;
  icon: React.ReactNode;
  text: string;
  href?: string;
  isExpanded: boolean;
  onHoverExpand?: () => void;
  onPress?: () => void;
}) {
  const router = useRouter();
  const [isHovered, setIsHovered] = React.useState(false);
  return (
    <Pressable
      {...({
        onPress: () => {
          if (onPress) return onPress();
          if (href) router.push(href);
        },
        onHoverIn: () => {
          setIsHovered(true);
          onHoverExpand?.();
        },
        onHoverOut: () => setIsHovered(false),
      } as any)}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          width: isExpanded ? '100%' : 'auto',
          alignSelf: isExpanded ? 'stretch' : 'flex-start',
          marginBottom: 8,
          marginEnd: 0,
          borderRadius: 999,
          paddingVertical: 8,
          paddingHorizontal: isExpanded ? 12 : 10,
          marginLeft: 0,
          backgroundColor: pressed
            ? `${colors.primaryColor}33`
            : isHovered
              ? `${colors.primaryColor}1A`
              : 'transparent',
          ...(Platform.select({
            web: {
              transition: 'background-color 150ms ease',
            },
          }) as any),
          ...Platform.select({
            web: {
              cursor: 'pointer',
            },
          }),
        },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'flex-start' }}>
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </View>
        {isExpanded ? (
          <Text
            style={{
              marginStart: 12,
              fontSize: 15,
              color: isActive || isHovered ? colors.primaryColor : colors.COLOR_BLACK,
            }}
          >
            {text}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
