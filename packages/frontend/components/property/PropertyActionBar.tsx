/**
 * PropertyActionBar — the bar pinned under a listing that is not a bookable
 * stay (a stay gets Bloom's `BookingBar`), on Bloom's `listing-actions`
 * `ActionBar`: the headline price on the left, one primary action and at most
 * one icon-only secondary action on the right.
 *
 * Which action leads is Homiio's rule, not Bloom's, and is decided here:
 *
 *  - **Public housing** applies on the state's website.
 *  - **External listings** (`isExternal`) never reach an in-app enquiry flow:
 *    the primary opens the source website (the caller's `onContact` does the
 *    `Linking.openURL(sourceUrl)` and the missing-URL error), and a call is
 *    offered only when the ADVERTISER published a phone or WhatsApp.
 *  - A call is never offered on a Homiio listing: no owner-published phone
 *    exists for one (see `canCall`).
 *  - **Exchange** requests a swap; **sale** requests a viewing. Neither has a
 *    secondary: Homiio has no messaging product, and the rental "Contact" flow
 *    (a tenant application) is the wrong answer to a swap or a purchase.
 *  - **Everything else** contacts the owner.
 *
 * A secondary action that could not be used is left out rather than drawn
 * disabled: `ActionBar`'s icon button has no disabled state, and an icon that
 * does nothing when pressed reads as broken.
 */
import React from 'react';
import { Platform, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { RiPhoneLine } from '@oxy.so/bloom/icons';
import { ActionBar, type ActionBarProps } from '@oxy.so/bloom/listing-actions';
import { HousingType, type Property } from '@homiio/shared-types';

interface Props {
  property: Property | null;
  /** The headline price, pre-formatted with its unit ("€1,200/month"). */
  price: string;
  /** Its spoken form. */
  priceAccessibilityLabel?: string;
  /** Whether a phone the advertiser published is available to call. */
  canCall: boolean;
  onContact: () => void;
  onCall: () => void;
  onApplyPublic: () => void;
  /** For sale: the primary becomes "Request viewing". */
  isSaleListing?: boolean;
  onRequestViewing?: () => void;
  /**
   * Open to home exchange: the primary becomes "Request exchange". Wins over the
   * sale action on a listing that is both, being the more specific flow.
   */
  isExchangeListing?: boolean;
  onRequestExchange?: () => void;
}

type BarActions = Pick<
  ActionBarProps,
  'primaryLabel' | 'onPrimary' | 'secondaryIcon' | 'secondaryLabel' | 'onSecondary'
>;

export const PropertyActionBar: React.FC<Props> = ({
  property,
  price,
  priceAccessibilityLabel,
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

  const call = canCall
    ? { secondaryIcon: RiPhoneLine, secondaryLabel: t('listing.cta.callNow'), onSecondary: onCall }
    : {};

  let actions: BarActions;
  if (property.housingType === HousingType.PUBLIC) {
    actions = { primaryLabel: t('listing.cta.applyOnStateWebsite'), onPrimary: onApplyPublic };
  } else if (property.isExternal) {
    actions = { primaryLabel: t('listing.cta.viewOnSourceWebsite'), onPrimary: onContact, ...call };
  } else if (isExchangeListing && onRequestExchange) {
    actions = { primaryLabel: t('listing.exchange.requestCta'), onPrimary: onRequestExchange };
  } else if (isSaleListing && onRequestViewing) {
    actions = { primaryLabel: t('listing.sale.requestViewing'), onPrimary: onRequestViewing };
  } else {
    // Signed out, `onContact` asks the viewer to sign in rather than the
    // button sitting disabled without a reason.
    actions = { primaryLabel: t('properties.contact'), onPrimary: onContact, ...call };
  }

  return (
    <ActionBar
      price={price}
      priceAccessibilityLabel={priceAccessibilityLabel}
      {...actions}
      style={styles.bar}
    />
  );
};

const styles = {
  // RN-Web supports `position: 'sticky'`, absent from RN's ViewStyle.
  bar: Platform.select<ViewStyle>({
    web: { position: 'sticky', bottom: 0, zIndex: 1000 } as unknown as ViewStyle,
    default: {},
  }),
};

export default PropertyActionBar;
