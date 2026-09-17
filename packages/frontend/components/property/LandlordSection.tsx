import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Section, SECTION_GUTTER } from '@/components/property/Section';
import { Avatar } from '@oxy.so/bloom/avatar';
import { Badge } from '@oxy.so/bloom/badge';
import { colors } from '@/styles/colors';
import { hairline, spacing } from '@/constants/styles';
import { Button } from '@oxy.so/bloom/button';
import { IconCircle } from '@oxy.so/bloom/icon-circle';
import {
    RiArrowRightSLine,
    RiBankLine,
    RiGlobalLine,
    RiUserLine,
} from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { FollowButton, useOxy } from '@oxy.so/services';
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

const AVATAR_SIZE = 52;

export const LandlordSection: React.FC<LandlordSectionProps> = ({
    property,
    landlordProfile,
    ownerProperties,
    onApplyPublic,
    t,
}) => {
    const router = useRouter();
    const { user } = useOxy();
    const isPublicHousing = property?.housingType === 'public';
    // Public-housing authority label uses the resolved region NAME (geo is relational).
    const publicHousingState = property?.address?.regionName;

    // Resolve the landlord's Oxy avatar file id (batched, cached). Rendered via
    // Bloom Avatar + the app-wide ImageResolverProvider, which builds the
    // canonical Oxy media URL — components never construct media URLs.
    const { getAvatarFileId } = useOxyAvatars([landlordProfile?.oxyUserId]);
    const landlordOxyUserId = landlordProfile?.oxyUserId;
    const showFollowButton = Boolean(
        landlordOxyUserId && user?.id && user.id !== landlordOxyUserId,
    );

    const getLandlordDisplayName = (profile: Profile | null): string => {
        if (!profile) return 'Unknown Owner';
        const bio = profile.personalProfile?.personalInfo?.bio;
        return bio || profile.oxyUserId || 'Property Owner';
    };

    const getLandlordSubtitle = (profile: Profile | null): string => {
        if (!profile) return 'Profile not available';
        return 'Property Owner';
    };

    const renderAvatar = (profile: Profile | null) => {
        if (!profile) {
            return (
                <Avatar
                    size={AVATAR_SIZE}
                    color="neutral"
                    placeholderIcon={
                        <RiUserLine width={26} height={26} fill={colors.COLOR_BLACK_LIGHT_3} />
                    }
                />
            );
        }
        // Prefer the Oxy avatar (a file id resolved to a URL by the registered
        // ImageResolver via getFileDownloadUrl); fall back to a profile-local
        // custom avatar for non-Oxy / unresolved cases.
        const avatarFileId = getAvatarFileId(profile.oxyUserId);
        const customAvatar = profile.personalProfile?.personalInfo?.avatar || profile.avatar;
        return (
            <Avatar
                source={avatarFileId ?? customAvatar}
                variant="thumb"
                name={getLandlordDisplayName(profile)}
                size={AVATAR_SIZE}
            />
        );
    };

    const isVerified = Boolean(landlordProfile?.personalProfile?.verification?.identity);

    return (
        <Section
            fullBleed
            title={isPublicHousing ? t('listing.cta.housingAuthority') : t('listing.cta.landlord')}
        >
            {isPublicHousing ? (
                <View style={[styles.contentContainer, styles.gutter]}>
                    <Item
                        leading={
                            <IconCircle
                                icon={RiBankLine}
                                size="lg"
                                style={styles.governmentAvatar}
                                iconStyle={styles.governmentIcon}
                            />
                        }
                        title={publicHousingState ? `${publicHousingState} Housing Authority` : 'Public Housing Authority'}
                        subtitle="Government-managed affordable housing"
                        trailing={<Badge content="GOV" variant="solid" color="info" size="small" />}
                        style={styles.flushRow}
                    />
                    <Button
                        leadingIcon={RiGlobalLine}
                        onPress={onApplyPublic}
                        variant="primary"
                        size="medium"
                        style={styles.actionButton}
                    >
                        {t('listing.cta.applyOnStateWebsite')}
                    </Button>
                </View>
            ) : (
                <View style={styles.contentContainer}>
                    <View style={styles.gutter}>
                        <Item
                            leading={renderAvatar(landlordProfile)}
                            title={getLandlordDisplayName(landlordProfile)}
                            subtitle={getLandlordSubtitle(landlordProfile)}
                            trailing={
                                <View style={styles.trailing}>
                                    {isVerified ? (
                                        <Badge
                                            content={t('property.host.verified')}
                                            variant="solid"
                                            color="success"
                                            size="small"
                                        />
                                    ) : null}
                                    <RiArrowRightSLine width={20} height={20} fill={colors.COLOR_BLACK_LIGHT_3} />
                                </View>
                            }
                            onPress={() => {
                                if (landlordProfile?.oxyUserId) {
                                    router.push(`/roommates/${landlordProfile.oxyUserId}`);
                                }
                            }}
                            accessibilityLabel={getLandlordDisplayName(landlordProfile)}
                            style={styles.flushRow}
                        />
                    </View>

                    {showFollowButton && landlordOxyUserId ? (
                        <View style={[styles.gutter, styles.followRow]}>
                            <FollowButton userId={landlordOxyUserId} size="small" />
                        </View>
                    ) : null}

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
                                        onPress={() => router.push(`/properties/${prop.id}`)}
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
    // The section gutter already insets the row; drop Item's own side padding
    // so the avatar lines up with the section title.
    flushRow: {
        paddingLeft: 0,
        paddingRight: 0,
    },
    trailing: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    governmentAvatar: {
        backgroundColor: colors.governmentBadge,
    },
    governmentIcon: {
        color: colors.white,
    },
    followRow: {
        alignItems: 'flex-start',
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
