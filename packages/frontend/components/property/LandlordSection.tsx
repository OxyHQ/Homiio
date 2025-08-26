import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { SectionCard } from '@/components/ui/SectionCard';
import ProfileAvatar from '@/components/ProfileAvatar';
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
        if (!profile) return '?';
        switch (profile.profileType) {
            case 'personal':
                return profile.personalProfile?.personalInfo?.bio || profile.oxyUserId || '?';
            case 'agency':
                return profile.agencyProfile?.legalCompanyName || profile.oxyUserId || '?';
            case 'business':
                return profile.businessProfile?.legalCompanyName || profile.oxyUserId || '?';
            case 'cooperative':
                return profile.cooperativeProfile?.legalName || profile.oxyUserId || '?';
            default:
                return profile.oxyUserId || '?';
        }
    };

    const getLandlordTrustScore = (profile: Profile | null): string => {
        if (!profile || profile.profileType !== 'personal') return 'No rating yet';
        return profile.personalProfile?.trustScore?.score
            ? `Trust Score: ${profile.personalProfile.trustScore.score}`
            : 'No rating yet';
    };
    return (
        <SectionCard
            title={isPublicHousing ? t('Housing Authority') : t('Landlord')}
            padding={20}
            borderRadius={16}
        >
            {isPublicHousing ? (
                <>
                    <View style={styles.landlordHeader}>
                        <View style={[styles.landlordAvatar, styles.governmentAvatar]}>
                            <Ionicons name="library" size={28} color="white" />
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
                            <ThemedText style={styles.landlordRating}>Government-managed affordable housing</ThemedText>
                        </View>
                    </View>
                    <ActionButton
                        icon="globe"
                        text={t('Apply on State Website') || 'Apply on State Website'}
                        onPress={onApplyPublic}
                        variant="primary"
                        size="medium"
                        style={{ flex: 1 }}
                    />
                </>
            ) : (
                <>
                    <TouchableOpacity
                        style={styles.landlordHeader}
                        onPress={() => router.push(`/profile/${(landlordProfile as any)?._id || (landlordProfile as any)?.id}`)}
                    >
                        <ProfileAvatar profile={landlordProfile} size={56} style={styles.landlordAvatar} />
                        <View style={styles.landlordInfo}>
                            <View style={styles.landlordNameRow}>
                                <ThemedText style={styles.landlordName}>{getLandlordDisplayName(landlordProfile)}</ThemedText>
                                {landlordProfile?.isActive && (
                                    <View style={styles.verifiedBadge}>
                                        <ThemedText style={styles.verifiedText}>✓</ThemedText>
                                    </View>
                                )}
                            </View>
                            <ThemedText style={styles.landlordRating}>{getLandlordTrustScore(landlordProfile)}</ThemedText>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={colors.COLOR_BLACK_LIGHT_3} />
                    </TouchableOpacity>
                    {landlordProfile && ownerProperties.length > 0 && (
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
                    )}
                </>
            )}
        </SectionCard>
    );
};

const styles = StyleSheet.create({
    landlordHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    landlordAvatar: { marginRight: 16 },
    governmentAvatar: { backgroundColor: '#1E40AF' },
    landlordInfo: { flex: 1 },
    landlordNameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    landlordName: { fontSize: 18, fontWeight: '600', color: '#1F2937', marginRight: 8 },
    verifiedBadge: { backgroundColor: '#10B981', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 12 },
    governmentBadge: { backgroundColor: '#1E40AF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
    verifiedText: { color: 'white', fontSize: 12, fontWeight: 'bold' },
    landlordRating: { fontSize: 14, color: '#6B7280', fontWeight: '500' },
});
