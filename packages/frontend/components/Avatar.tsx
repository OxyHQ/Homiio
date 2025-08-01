import React from "react";
import { Image, ImageSourcePropType, Pressable , StyleSheet, ImageStyle } from 'react-native';
import { colors } from "@/styles/colors";
import defaultAvatar from "@/assets/images/default-avatar.jpg";

interface AvatarProps {
  id?: string; // Avatar ID or full URL
  size?: number;
  style?: ImageStyle;
  onPress?: () => void;
}

const Avatar: React.FC<AvatarProps> = ({ id, size = 40, style, onPress }) => {
  // Handle different avatar formats
  let source;

  if (!id) {
    // Use default avatar if no ID provided
    source = defaultAvatar;
  } else if (id.startsWith('http')) {
    // If it's already a full URL, use it directly
    source = { uri: id };
  } else {
    // Otherwise, construct the URL using the cloud URL
    source = { uri: `${id}` };
  }

  return (
    <Pressable onPress={onPress} disabled={!onPress}>
      <Image
        source={source}
        style={[styles.avatar, { width: size, height: size, borderRadius: size }, style]}
        defaultSource={defaultAvatar}
        onError={(e) => console.warn('Avatar image failed to load:', id)}
      />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
  },
});

export default Avatar;