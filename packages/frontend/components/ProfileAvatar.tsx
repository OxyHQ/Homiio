import React from 'react';
import { ImageStyle } from 'react-native';
import { Avatar } from '@oxyhq/bloom/avatar';
import { Profile } from '@homiio/shared-types';

interface ProfileAvatarProps {
  profile: Profile | null;
  size?: number;
  style?: ImageStyle;
  onPress?: () => void;
}

const getAvatarUrl = (profile: Profile | null): string | undefined => {
  if (!profile) return undefined;
  return profile.avatar || profile.personalProfile?.personalInfo?.avatar;
};

const ProfileAvatar: React.FC<ProfileAvatarProps> = ({ profile, size = 40, style, onPress }) => {
  return (
    <Avatar
      source={getAvatarUrl(profile)}
      size={size}
      imageStyle={style}
      onPress={onPress}
    />
  );
};

export default ProfileAvatar;
