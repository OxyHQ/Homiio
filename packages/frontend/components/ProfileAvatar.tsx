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
    if (profile.avatar) return profile.avatar;
    switch (profile.profileType) {
        case 'personal':
            return profile.personalProfile?.personalInfo?.avatar;
        case 'agency':
            return profile.agencyProfile?.businessDetails?.logo;
        case 'business':
            return profile.businessProfile?.businessDetails?.logo;
        case 'cooperative':
        default:
            return undefined;
    }
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
