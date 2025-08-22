import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton } from '@/components/ui/ActionButton';

interface Props {
    property: any;
    landlordProfile: any;
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
    const isPublic = property?.housingType === 'public';
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
    bottomBar: {
        position: 'sticky' as any,
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#e9ecef',
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    bottomBarInner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
});

export default PropertyActionBar;
