import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { SectionCard } from '@/components/ui/SectionCard';
import ProfileAvatar from '@/components/ProfileAvatar';
import Avatar from '@/components/Avatar';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { ActionButton } from '@/components/ui/ActionButton';
import type { Profile, Property } from '@homiio/shared-types';
import { HomeCarouselSection } from '@/components/HomeCarouselSection';
import { PropertyCard } from '@/components/PropertyCard';
import { useRouter } from 'expo-router';

interface LandlordSectionProps {
    property: Property;
    landlordProfile: Profile | null;
    ownerProperties: Property[];
    onApplyPublic: () => void;
    t: (k: string, d?: string) => string | undefined;
}

export const LandlordSection: React.FC<LandlordSectionProps> = ({
    property,
    landlordProfile,
    ownerProperties,
    onApplyPublic,
    t,
}) => {
    const router = useRouter();
    const isPublicHousing = property?.housingType === 'public';
    const publicHousingState = property?.address?.state;

    const getLandlordDisplayName = (profile: Profile | null): string => {
        if (!profile) return 'Unknown Owner';
        switch (profile.profileType) {
            case 'personal':
                const bio = profile.personalProfile?.personalInfo?.bio;
                return bio || profile.oxyUserId || 'Property Owner';
            case 'agency':
                return profile.agencyProfile?.legalCompanyName || profile.oxyUserId || 'Real Estate Agency';
            case 'business':
                return profile.businessProfile?.legalCompanyName || profile.oxyUserId || 'Property Management';
            case 'cooperative':
                return profile.cooperativeProfile?.legalName || profile.oxyUserId || 'Housing Cooperative';
            default:
                return profile.oxyUserId || 'Property Owner';
        }
    };

    const getLandlordSubtitle = (profile: Profile | null): string => {
        if (!profile) return 'Profile not available';

        const trustScore = profile.profileType === 'personal'
            ? profile.personalProfile?.trustScore?.score
            : null;

        switch (profile.profileType) {
            case 'personal':
                return trustScore ? `Trust Score: ${trustScore}/10` : 'Property Owner';
            case 'agency':
                const agencyRating = profile.agencyProfile?.ratings?.average;
                return agencyRating ? `Real Estate Agency • ${agencyRating.toFixed(1)}★` : 'Real Estate Agency';
            case 'business':
                const businessRating = profile.businessProfile?.ratings?.average;
                return businessRating ? `Property Management • ${businessRating.toFixed(1)}★` : 'Property Management Company';
            case 'cooperative':
                return 'Housing Cooperative';
            default:
                return 'Property Owner';
        }
    };

    const renderPersonalProfileAvatar = (profile: Profile) => {
        // For personal profiles, use Oxy avatar
        const oxyAvatarUrl = profile.oxyUserId
            ? `https://cdn.oxy.so/avatars/${profile.oxyUserId}`
            : undefined;

        const customAvatar = profile.personalProfile?.personalInfo?.avatar || profile.avatar;

        const avatarSource = oxyAvatarUrl || customAvatar;

        return (
            <Avatar
                id={avatarSource}
                size={52}
                style={styles.landlordAvatar}
            />
        );
    };

    const renderAvatar = (profile: Profile | null) => {
        if (!profile) {
            return (
                <View style={[styles.landlordAvatar, styles.defaultAvatar]}>
                    <Ionicons name="person" size={26} color={colors.COLOR_BLACK_LIGHT_3} />
                </View>
            );
        }

        if (profile.profileType === 'personal') {
            return renderPersonalProfileAvatar(profile);
        }

        return <ProfileAvatar profile={profile} size={52} style={styles.landlordAvatar} />;
    };
    return (
        <SectionCard
            title={isPublicHousing ? t('Housing Authority') || 'Housing Authority' : t('Landlord') || 'Landlord'}
            padding={0}
            borderRadius={16}
        >
            {isPublicHousing ? (
                <View style={styles.contentContainer}>
                    <View style={styles.landlordHeader}>
                        <View style={[styles.landlordAvatar, styles.governmentAvatar]}>
                            <Ionicons name="library" size={26} color="white" />
                        </View>
                        <View style={styles.landlordInfo}>
                            <View style={styles.landlordNameRow}>
                                <ThemedText style={styles.landlordName}>
                                    {publicHousingState ? `${publicHousingState} Housing Authority` : 'Public Housing Authority'}
                                </ThemedText>
                                <View style={[styles.verifiedBadge, styles.governmentBadge]}>
                                    <ThemedText style={styles.verifiedText}>GOV</ThemedText>
                                </View>
                            </View>
                            <ThemedText style={styles.landlordSubtitle}>Government-managed affordable housing</ThemedText>
                        </View>
                    </View>
                    <ActionButton
                        icon="globe"
                        text={t('Apply on State Website') || 'Apply on State Website'}
                        onPress={onApplyPublic}
                        variant="primary"
                        size="medium"
                        style={styles.actionButton}
                    />
                </View>
            ) : (
                <View style={styles.contentContainer}>
                    <TouchableOpacity
                        style={styles.landlordHeader}
                        onPress={() => router.push(`/profile/${(landlordProfile as any)?._id || (landlordProfile as any)?.id}`)}
                        activeOpacity={0.7}
                    >
                        {renderAvatar(landlordProfile)}
                        <View style={styles.landlordInfo}>
                            <View style={styles.landlordNameRow}>
                                <ThemedText style={styles.landlordName}>{getLandlordDisplayName(landlordProfile)}</ThemedText>
                                {landlordProfile?.isActive && (
                                    <View style={styles.verifiedBadge}>
                                        <Ionicons name="checkmark" size={12} color="white" />
                                    </View>
                                )}
                            </View>
                            <ThemedText style={styles.landlordSubtitle}>{getLandlordSubtitle(landlordProfile)}</ThemedText>
                        </View>
                        <View style={styles.chevronContainer}>
                            <Ionicons name="chevron-forward" size={20} color={colors.COLOR_BLACK_LIGHT_3} />
                        </View>
                    </TouchableOpacity>

                    {landlordProfile && ownerProperties.length > 0 && (
                        <View style={styles.propertiesSection}>
                            <HomeCarouselSection
                                title={t('More properties by this owner') || 'More properties by this owner'}
                                items={ownerProperties}
                                loading={false}
                                renderItem={(prop) => (
                                    <PropertyCard
                                        property={prop as any}
                                        variant="compact"
                                        onPress={() => router.push(`/properties/${(prop as any)._id || (prop as any).id}`)}
                                        showSaveButton={false}
                                        showVerifiedBadge={false}
                                        showRating={false}
                                    />
                                )}
                            />
                        </View>
                    )}
                </View>
            )}
        </SectionCard>
    );
};

const styles = StyleSheet.create({
    contentContainer: {
        padding: 16,
    },
    landlordHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
        paddingVertical: 2,
    },
    landlordAvatar: {
        marginRight: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 1,
    },
    defaultAvatar: {
        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
        borderRadius: 26,
        width: 52,
        height: 52,
        justifyContent: 'center',
        alignItems: 'center',
    },
    governmentAvatar: {
        backgroundColor: '#1E40AF',
        borderRadius: 26,
        width: 52,
        height: 52,
        justifyContent: 'center',
        alignItems: 'center',
    },
    landlordInfo: {
        flex: 1,
        justifyContent: 'center',
    },
    landlordNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
        flexWrap: 'wrap',
    },
    landlordName: {
        fontSize: 16,
        fontWeight: '700',
        color: '#1F2937',
        marginRight: 6,
        lineHeight: 20,
    },
    landlordSubtitle: {
        fontSize: 13,
        color: '#6B7280',
        fontWeight: '500',
        lineHeight: 16,
    },
    verifiedBadge: {
        backgroundColor: '#10B981',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    governmentBadge: {
        backgroundColor: '#1E40AF',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    verifiedText: {
        color: 'white',
        fontSize: 11,
        fontWeight: '700',
    },
    chevronContainer: {
        padding: 4,
        marginRight: -4,
    },
    actionButton: {
        marginTop: 2,
    },
    propertiesSection: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
    },
});
