import React from 'react';
import { ImageStyle } from 'react-native';
import { Avatar } from '@oxyhq/bloom/avatar';
import type { Profile } from '@homiio/shared-types';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';

interface ProfileAvatarProps {
  profile: Profile | null;
  size?: number;
  style?: ImageStyle;
  onPress?: () => void;
}

const ProfileAvatar: React.FC<ProfileAvatarProps> = ({ profile, size = 40, style, onPress }) => {
  const { getAvatarFileId } = useOxyAvatars(profile?.oxyUserId ? [profile.oxyUserId] : []);
  const fileId = profile?.oxyUserId ? getAvatarFileId(profile.oxyUserId) : undefined;

  return (
    <Avatar
      source={fileId}
      variant="thumb"
      size={size}
      imageStyle={style}
      onPress={onPress}
    />
  );
};

export default ProfileAvatar;
