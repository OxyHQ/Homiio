import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton } from '@/components/ui/ActionButton';
import { HousingType, type Profile, type Property } from '@homiio/shared-types';
import { colors } from '@/styles/colors';

interface Props {
    property: Property | null;
    landlordProfile: Profile | null;
    canContact: boolean;
    canCall: boolean;
    onContact: () => void;
    onCall: () => void;
    onApplyPublic: () => void;
}

export const PropertyActionBar: React.FC<Props> = ({
    property,
    landlordProfile,
    canContact,
    canCall,
    onContact,
    onCall,
    onApplyPublic,
}) => {
    const { t } = useTranslation();
    if (!property) return null;
    const isPublic = property.housingType === HousingType.PUBLIC;
    const isExternal = property.isExternal;
    return (
        <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
            <View style={styles.bottomBarInner}>
                {isPublic ? (
                    <ActionButton
                        icon="globe"
                        text={t('Apply on State Website')}
                        onPress={onApplyPublic}
                        variant="primary"
                        size="large"
                        style={{ flex: 1 }}
                    />
                ) : isExternal ? (
                    <ActionButton
                        icon="open-outline"
                        text={t('View on Source Website')}
                        onPress={onContact}
                        variant="primary"
                        size="large"
                        style={{ flex: 1 }}
                    />
                ) : (
                    <>
                        <ActionButton
                            icon="chatbubble-outline"
                            text={t('properties.contact')}
                            onPress={onContact}
                            variant="primary"
                            size="large"
                            disabled={!landlordProfile || !canContact}
                            style={{ flex: 1, marginRight: 10 }}
                        />
                        {canCall && landlordProfile && (
                            <ActionButton
                                icon="call-outline"
                                text={t('Call Now')}
                                onPress={onCall}
                                variant="secondary"
                                size="large"
                                style={{ flex: 1 }}
                            />
                        )}
                    </>
                )}
            </View>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    // RN-Web supports `position: 'sticky'`, absent from RN's ViewStyle.
    bottomBar: {
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        backgroundColor: colors.white,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingHorizontal: 16,
        paddingVertical: 12,
    } as unknown as ViewStyle,
    bottomBarInner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
});

export default PropertyActionBar;
