import React from 'react';
import { Profile } from '@homiio/shared-types';
import Avatar from './Avatar';
import { ImageStyle } from 'react-native';

interface ProfileAvatarProps {
    profile: Profile | null;
    size?: number;
    style?: ImageStyle;
    onPress?: () => void;
}

const ProfileAvatar: React.FC<ProfileAvatarProps> = ({ profile, size = 40, style, onPress }) => {
    const getAvatarUrl = (profile: Profile | null): string | undefined => {
        if (!profile) return undefined;

        // First check for direct avatar field
        if (profile.avatar) return profile.avatar;

        // Then check for profile-specific fields
        switch (profile.profileType) {
            case 'personal':
                return profile.personalProfile?.avatar || profile.personalProfile?.personalInfo?.avatar;
            case 'agency':
                return profile.agencyProfile?.avatar || profile.agencyProfile?.businessDetails?.logo;
            case 'business':
                return profile.businessProfile?.avatar || profile.businessProfile?.businessDetails?.logo;
            case 'cooperative':
                return profile.cooperativeProfile?.avatar || profile.cooperativeProfile?.logo;
            default:
                return undefined;
        }
    };

    return (
        <Avatar
            id={getAvatarUrl(profile)}
            size={size}
            style={style}
            onPress={onPress}
        />
    );
};

export default ProfileAvatar;
