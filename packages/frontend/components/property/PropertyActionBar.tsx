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
    /**
     * Whether this listing is for sale. When true (and the listing isn't public
     * housing / external), the primary CTA becomes "Request viewing" — buyers
     * book a viewing rather than starting a rental enquiry. Rent/vacation CTAs
     * are unchanged.
     */
    isSaleListing?: boolean;
    /** Open the viewing-request flow (sale-listing primary CTA). */
    onRequestViewing?: () => void;
    /**
     * Whether this listing is open to home exchange. When true (and not public
     * housing / external), the primary CTA becomes "Request exchange" — guests
     * propose a swap or hosting stay. Takes precedence over the sale CTA when a
     * listing is both, since exchange is the more specific exchange-flow action.
     */
    isExchangeListing?: boolean;
    /** Open the request-exchange flow (exchange-listing primary CTA). */
    onRequestExchange?: () => void;
}

export const PropertyActionBar: React.FC<Props> = ({
    property,
    landlordProfile,
    canContact,
    canCall,
    onContact,
    onCall,
    onApplyPublic,
    isSaleListing = false,
    onRequestViewing,
    isExchangeListing = false,
    onRequestExchange,
}) => {
    const { t } = useTranslation();
    if (!property) return null;
    const isPublic = property.housingType === HousingType.PUBLIC;
    const isExternal = property.isExternal;
    // Exchange listings (other than public/external ones) lead with "Request
    // exchange" + a secondary contact CTA. Checked before the sale CTA so a
    // listing that is both for-sale and exchangeable surfaces the exchange flow.
    let exchangePrimary: React.ReactNode = null;
    if (isExchangeListing && !isPublic && !isExternal && onRequestExchange) {
        exchangePrimary = (
            <>
                <ActionButton
                    icon="swap-horizontal"
                    text={t('listing.exchange.requestCta', 'Request exchange')}
                    onPress={onRequestExchange}
                    variant="primary"
                    size="large"
                    style={{ flex: 1, marginRight: 10 }}
                />
                <ActionButton
                    icon="chatbubble-outline"
                    text={t('properties.contact')}
                    onPress={onContact}
                    variant="secondary"
                    size="large"
                    disabled={!landlordProfile || !canContact}
                    style={{ flex: 1 }}
                />
            </>
        );
    }
    // Sale listings (other than public/external ones) lead with "Request
    // viewing" instead of the rental contact CTA. Requires a handler to be
    // useful, so we fall back to the standard CTA when none is provided. The
    // explicit `if` narrows `onRequestViewing` to a defined callback.
    let salePrimary: React.ReactNode = null;
    if (isSaleListing && !isPublic && !isExternal && onRequestViewing) {
        salePrimary = (
            <>
                <ActionButton
                    icon="calendar-outline"
                    text={t('listing.sale.requestViewing', 'Request viewing')}
                    onPress={onRequestViewing}
                    variant="primary"
                    size="large"
                    style={{ flex: 1, marginRight: 10 }}
                />
                <ActionButton
                    icon="chatbubble-outline"
                    text={t('properties.contact')}
                    onPress={onContact}
                    variant="secondary"
                    size="large"
                    disabled={!landlordProfile || !canContact}
                    style={{ flex: 1 }}
                />
            </>
        );
    }
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
                    <>
                        <ActionButton
                            icon="open-outline"
                            text={t('View on Source Website')}
                            onPress={onContact}
                            variant="primary"
                            size="large"
                            style={{ flex: 1, marginRight: canCall ? 10 : 0 }}
                        />
                        {canCall ? (
                            <ActionButton
                                icon="call-outline"
                                text={t('Call Now')}
                                onPress={onCall}
                                variant="secondary"
                                size="large"
                                style={{ flex: 1 }}
                            />
                        ) : null}
                    </>
                ) : exchangePrimary ? (
                    exchangePrimary
                ) : salePrimary ? (
                    salePrimary
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
