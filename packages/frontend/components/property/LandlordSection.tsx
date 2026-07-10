import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { Section, SECTION_GUTTER } from '@/components/property/Section';
import ProfileAvatar from '@/components/ProfileAvatar';
import { Avatar } from '@oxyhq/bloom/avatar';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { hairline, spacing } from '@/constants/styles';
import { ActionButton } from '@/components/ui/ActionButton';
import type { Profile, Property } from '@homiio/shared-types';
import { HomeCarouselSection } from '@/components/HomeCarouselSection';
import { PropertyCard } from '@/components/PropertyCard';
import { useRouter } from 'expo-router';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';

interface LandlordSectionProps {
    property: Property;
    landlordProfile: Profile | null;
    ownerProperties: Property[];
    onApplyPublic: () => void;
    t: (k: string) => string;
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
    // Public-housing authority label uses the resolved region NAME (geo is relational).
    const publicHousingState = property?.address?.regionName;

    // Resolve the landlord's Oxy avatar file id (batched, cached). Rendered via
    // Bloom Avatar + the app-wide ImageResolverProvider, which builds the
    // canonical Oxy media URL — components never construct media URLs.
    const { getAvatarFileId } = useOxyAvatars([landlordProfile?.oxyUserId]);

    const getLandlordDisplayName = (profile: Profile | null): string => {
        if (!profile) return 'Unknown Owner';
        const bio = profile.personalProfile?.personalInfo?.bio;
        return bio || profile.oxyUserId || 'Property Owner';
    };

    const getLandlordSubtitle = (profile: Profile | null): string => {
        if (!profile) return 'Profile not available';
        return 'Property Owner';
    };

    const renderPersonalProfileAvatar = (profile: Profile) => {
        // Prefer the Oxy avatar (a file id resolved to a URL by the registered
        // ImageResolver via getFileDownloadUrl); fall back to a profile-local
        // custom avatar for non-Oxy / unresolved cases.
        const avatarFileId = getAvatarFileId(profile.oxyUserId);
        const customAvatar = profile.personalProfile?.personalInfo?.avatar || profile.avatar;

        return (
            <Avatar
                source={avatarFileId ?? customAvatar}
                variant="thumb"
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

        return renderPersonalProfileAvatar(profile);
    };
    return (
        <Section
            fullBleed
            title={isPublicHousing ? t('listing.cta.housingAuthority') : t('listing.cta.landlord')}
        >
            {isPublicHousing ? (
                <View style={[styles.contentContainer, styles.gutter]}>
                    <View style={styles.landlordHeader}>
                        <View style={[styles.landlordAvatar, styles.governmentAvatar]}>
                            <Ionicons name="library" size={26} color={colors.white} />
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
                        text={t('listing.cta.applyOnStateWebsite')}
                        onPress={onApplyPublic}
                        variant="primary"
                        size="medium"
                        style={styles.actionButton}
                    />
                </View>
            ) : (
                <View style={styles.contentContainer}>
                    <TouchableOpacity
                        style={[styles.landlordHeader, styles.gutter]}
                        onPress={() => {
                            if (landlordProfile?.oxyUserId) {
                                router.push(`/roommates/${landlordProfile.oxyUserId}`);
                            }
                        }}
                        activeOpacity={0.7}
                    >
                        {renderAvatar(landlordProfile)}
                        <View style={styles.landlordInfo}>
                            <View style={styles.landlordNameRow}>
                                <ThemedText style={styles.landlordName}>{getLandlordDisplayName(landlordProfile)}</ThemedText>
                                {landlordProfile?.personalProfile?.verification?.identity && (
                                    <View style={styles.verifiedBadge}>
                                        <Ionicons name="checkmark" size={12} color={colors.white} />
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
                                title={t('listing.cta.moreByOwner')}
                                items={ownerProperties}
                                loading={false}
                                renderItem={(prop) => (
                                    <PropertyCard
                                        property={prop}
                                        variant="compact"
                                        onPress={() => router.push(`/properties/${prop._id || prop.id}`)}
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
        </Section>
    );
};

const styles = StyleSheet.create({
    contentContainer: {
        gap: spacing.md,
    },
    gutter: {
        paddingHorizontal: SECTION_GUTTER,
    },
    landlordHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 2,
    },
    landlordAvatar: {
        marginRight: spacing.md,
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
        backgroundColor: colors.governmentBadge,
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
        color: colors.COLOR_BLACK_LIGHT_2,
        marginRight: 6,
        lineHeight: 20,
    },
    landlordSubtitle: {
        fontSize: 13,
        color: colors.muted,
        fontWeight: '500',
        lineHeight: 16,
    },
    verifiedBadge: {
        backgroundColor: colors.success,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    governmentBadge: {
        backgroundColor: colors.governmentBadge,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    verifiedText: {
        color: colors.white,
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
        paddingTop: spacing.md,
        borderTopWidth: hairline.width,
        borderTopColor: hairline.color,
    },
});
