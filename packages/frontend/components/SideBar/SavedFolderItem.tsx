import React from 'react';
import { View, Text, Platform, Image } from 'react-native';
import { Pressable } from 'react-native-web-hover';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';

export function SavedFolderItem({
    name,
    color,
    icon,
    propertyCount,
    href,
    isExpanded,
    onHoverExpand,
    onPress,
    latestImages,
}: {
    name: string;
    color: string;
    icon: string;
    propertyCount: number;
    href?: string;
    isExpanded: boolean;
    onHoverExpand?: () => void;
    onPress?: () => void;
    latestImages?: string[];
}) {
    const router = useRouter();
    const [isHovered, setIsHovered] = React.useState(false);
    const IconComponent = Ionicons as any;

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
                    ...(Platform.select({
                        web: {
                            transition: 'all 220ms cubic-bezier(0.2, 0, 0, 1)',
                            willChange: 'background-color, transform, padding',
                        },
                    }) as any),
                    ...Platform.select({
                        web: {
                            cursor: 'pointer',
                        },
                    }),
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                },
            ]}
        >
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                width: '100%',
                justifyContent: 'flex-start',
                gap: isExpanded ? 10 : 0,
                position: 'relative',
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
                    backgroundColor: color + '20',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    ...(Platform.select({
                        web: {
                            transition: 'all 220ms cubic-bezier(0.2, 0, 0, 1)',
                            willChange: 'border-radius',
                        },
                    }) as any),
                }}>
                    {latestImages && latestImages.length > 0 ? (
                        <View style={{ flexDirection: 'row', width: '100%', height: '100%' }}>
                            {latestImages.slice(0, 2).map((imageUrl, index) => (
                                <View
                                    key={index}
                                    style={{
                                        flex: 1,
                                        height: '100%',
                                        borderRightWidth: index === 0 && latestImages.length > 1 ? 1 : 0,
                                        borderRightColor: 'rgba(255, 255, 255, 0.3)',
                                    }}
                                >
                                    <Image
                                        source={{ uri: imageUrl }}
                                        style={{ width: '100%', height: '100%' }}
                                        resizeMode="cover"
                                    />
                                </View>
                            ))}
                        </View>
                    ) : (
                        <IconComponent name={icon} size={20} color={color} />
                    )}
                </View>

                {/* Property Count Badge */}
                {propertyCount > 0 && (
                    <View style={{
                        position: 'absolute',
                        bottom: -5,
                        left: 25,
                        backgroundColor: colors.primaryColor,
                        borderRadius: 10,
                        minWidth: 20,
                        height: 20,
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingHorizontal: 4,
                        borderWidth: 2,
                        borderColor: colors.primaryLight,
                    }}>
                        <Text style={{
                            fontSize: 10,
                            fontWeight: 'bold',
                            color: 'white',
                            fontFamily: 'Phudu',
                            textAlign: 'center',
                            lineHeight: 16,
                        }}>
                            {propertyCount > 99 ? '99+' : propertyCount}
                        </Text>
                    </View>
                )}
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
                        {name}
                    </Text>
                    <Text
                        style={{
                            fontSize: 12,
                            fontWeight: '400',
                            color: colors.primaryDark_2,
                            marginTop: 2,
                            ...(Platform.select({
                                web: {
                                    transition: 'color 220ms cubic-bezier(0.2, 0, 0, 1)',
                                    whiteSpace: 'nowrap',
                                },
                            }) as any),
                        }}
                        numberOfLines={1}
                    >
                        {propertyCount} {propertyCount === 1 ? 'property' : 'properties'}
                    </Text>
                </View>
            </View>
        </Pressable>
    );
}
