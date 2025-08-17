import React from 'react';
import { View, Text, Image, Platform } from 'react-native';
import { Pressable } from 'react-native-web-hover';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';

export function SavedPropertyItem({
    imageUrl,
    title,
    subtitle,
    href,
    isExpanded,
    onHoverExpand,
    onPress,
}: {
    imageUrl: string;
    title: string;
    subtitle?: string;
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
                    marginEnd: 0,
                    borderRadius: 12,
                    padding: 4,
                    marginLeft: 0,
                    backgroundColor: pressed
                        ? `${colors.primaryColor}20`
                        : isHovered
                            ? `${colors.primaryColor}0F`
                            : 'transparent',
                    ...Platform.select({
                        web: {
                            cursor: 'pointer',
                        },
                    }),
                },
            ]}
        >
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                width: '100%',
                justifyContent: 'flex-start',
                gap: isExpanded ? 10 : 0,
                ...(Platform.select({
                    web: {
                        transition: 'gap 220ms cubic-bezier(0.2, 0, 0, 1)',
                        willChange: 'gap',
                    },
                }) as any),
            }}>
                <View style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    overflow: 'hidden',
                    backgroundColor: colors.primaryColor + '20',
                    ...(Platform.select({
                        web: {
                            transition: 'all 220ms cubic-bezier(0.2, 0, 0, 1)',
                            willChange: 'border-radius',
                        },
                    }) as any),
                }}>
                    <Image
                        source={{ uri: imageUrl }}
                        style={{
                            width: '100%',
                            height: '100%',
                        }}
                        resizeMode="cover"
                    />
                </View>
                <View style={{
                    flex: 1,
                    minWidth: 0,
                    opacity: isExpanded ? 1 : 0,
                    height: isExpanded ? 'auto' : 0,
                    overflow: 'hidden',
                    ...(Platform.select({
                        web: {
                            transition: 'opacity 220ms cubic-bezier(0.2, 0, 0, 1), height 220ms cubic-bezier(0.2, 0, 0, 1)',
                            willChange: 'opacity, height',
                        },
                    }) as any),
                }}>
                    <Text
                        style={{
                            fontSize: 14,
                            fontWeight: '500',
                            fontFamily: 'Phudu',
                            color: colors.COLOR_BLACK,
                            ...(Platform.select({
                                web: {
                                    transition: 'color 220ms cubic-bezier(0.2, 0, 0, 1)',
                                    whiteSpace: 'nowrap',
                                },
                            }) as any),
                        }}
                        numberOfLines={1}
                    >
                        {title}
                    </Text>
                    {subtitle && (
                        <Text
                            style={{
                                fontSize: 12,
                                fontWeight: '400',
                                color: colors.primaryDark_2,
                                marginTop: 2,
                            }}
                            numberOfLines={1}
                        >
                            {subtitle}
                        </Text>
                    )}
                </View>
            </View>
        </Pressable>
    );
}
