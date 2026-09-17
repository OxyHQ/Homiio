/**
 * Direct contact row for external aggregator listings when portal AJAX
 * captured phone / email / WhatsApp on ingest.
 */
import React, { useCallback } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';

import { RiExternalLinkLine, RiMailLine, RiPhoneLine } from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { SECTION_GUTTER } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import type { Property } from '@homiio/shared-types';

interface Props {
  property: Property | null | undefined;
}

const LINK_ICON_SIZE = 18;
const TRAILING_ICON_SIZE = 16;

type ContactLink = {
  key: 'phone' | 'email' | 'whatsapp';
  label: string;
  href: string;
};

function buildContactLinks(
  contact: NonNullable<Property['externalContact']>,
): ContactLink[] {
  const links: ContactLink[] = [];
  if (contact.phone) {
    links.push({ key: 'phone', label: contact.phone, href: `tel:${contact.phone}` });
  }
  if (contact.email) {
    links.push({ key: 'email', label: contact.email, href: `mailto:${contact.email}` });
  }
  if (contact.whatsapp) {
    const digits = contact.whatsapp.replace(/\D/g, '');
    links.push({
      key: 'whatsapp',
      label: contact.whatsapp,
      href: `https://wa.me/${digits}`,
    });
  }
  return links;
}

/**
 * Leading glyph per channel. WhatsApp keeps the Ionicons brand logo: Bloom's
 * Remix set carries no WhatsApp mark, and a generic chat bubble would hide
 * which app the link opens.
 */
function ContactIcon({ kind }: { kind: ContactLink['key'] }) {
  if (kind === 'phone') {
    return <RiPhoneLine width={LINK_ICON_SIZE} height={LINK_ICON_SIZE} fill={colors.primaryColor} />;
  }
  if (kind === 'email') {
    return <RiMailLine width={LINK_ICON_SIZE} height={LINK_ICON_SIZE} fill={colors.primaryColor} />;
  }
  return <Ionicons name="logo-whatsapp" size={LINK_ICON_SIZE} color={colors.primaryColor} />;
}

function ContactLinkRow({ link }: { link: ContactLink }) {
  const open = useCallback(async () => {
    try {
      await Linking.openURL(link.href);
    } catch {
      // Swallow — OS may block unknown schemes in simulators.
    }
  }, [link.href]);

  return (
    <Item
      title={link.label}
      titleStyle={styles.linkText}
      leading={<ContactIcon kind={link.key} />}
      trailing={
        <RiExternalLinkLine
          width={TRAILING_ICON_SIZE}
          height={TRAILING_ICON_SIZE}
          fill={colors.COLOR_BLACK_LIGHT_3}
        />
      }
      onPress={open}
      accessibilityRole="link"
      accessibilityLabel={link.label}
      style={styles.linkRow}
    />
  );
}

export const ExternalContactSection: React.FC<Props> = ({ property }) => {
  const { t } = useTranslation();
  if (!property?.isExternal || !property.externalContact) return null;

  const links = buildContactLinks(property.externalContact);
  if (links.length === 0) return null;

  const displayName =
    property.externalContact.agencyName?.trim() ||
    property.externalContact.name?.trim();

  return (
    <View style={styles.container}>
      <BloomText style={styles.title}>
        {t('property.external.contactTitle')}
      </BloomText>
      {displayName ? (
        <BloomText style={styles.subtitle}>{displayName}</BloomText>
      ) : null}
      <View style={styles.links}>
        {links.map((link) => (
          <ContactLinkRow key={link.key} link={link} />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    paddingHorizontal: SECTION_GUTTER,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  subtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  links: {
    gap: spacing.xs,
  },
  linkRow: {
    backgroundColor: colors.mutedSubtle,
  },
  linkText: {
    color: colors.primaryColor,
    fontWeight: '500',
  },
});

export default ExternalContactSection;
