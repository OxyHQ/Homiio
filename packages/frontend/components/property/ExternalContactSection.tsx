/**
 * Direct contact row for external aggregator listings when portal AJAX
 * captured phone / email / WhatsApp on ingest.
 */
import React, { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { SECTION_GUTTER } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import type { Property } from '@homiio/shared-types';

interface Props {
  property: Property | null | undefined;
}

type ContactLink = {
  key: 'phone' | 'email' | 'whatsapp';
  label: string;
  value: string;
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
};

function buildContactLinks(
  contact: NonNullable<Property['externalContact']>,
): ContactLink[] {
  const links: ContactLink[] = [];
  if (contact.phone) {
    links.push({
      key: 'phone',
      label: contact.phone,
      value: contact.phone,
      href: `tel:${contact.phone}`,
      icon: 'call-outline',
    });
  }
  if (contact.email) {
    links.push({
      key: 'email',
      label: contact.email,
      value: contact.email,
      href: `mailto:${contact.email}`,
      icon: 'mail-outline',
    });
  }
  if (contact.whatsapp) {
    const digits = contact.whatsapp.replace(/\D/g, '');
    links.push({
      key: 'whatsapp',
      label: contact.whatsapp,
      value: contact.whatsapp,
      href: `https://wa.me/${digits}`,
      icon: 'logo-whatsapp',
    });
  }
  return links;
}

function ContactLinkRow({ link }: { link: ContactLink }) {
  const [pressed, setPressed] = useState(false);
  const open = useCallback(async () => {
    try {
      await Linking.openURL(link.href);
    } catch {
      // Swallow — OS may block unknown schemes in simulators.
    }
  }, [link.href]);

  return (
    <Pressable
      onPress={open}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onHoverIn={() => setPressed(true)}
      onHoverOut={() => setPressed(false)}
      accessibilityRole="link"
      accessibilityLabel={link.label}
      style={[styles.linkRow, pressed && styles.linkRowPressed]}
    >
      <Ionicons name={link.icon} size={18} color={colors.primaryColor} />
      <BloomText style={styles.linkText} numberOfLines={1}>
        {link.label}
      </BloomText>
      <Ionicons name="open-outline" size={14} color={colors.COLOR_BLACK_LIGHT_3} />
    </Pressable>
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
        {t('property.external.contactTitle', 'Contact on listing') ||
          'Contact on listing'}
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
    gap: spacing.sm,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.mutedSubtle,
  },
  linkRowPressed: {
    opacity: 0.85,
  },
  linkText: {
    flex: 1,
    fontSize: 14,
    color: colors.primaryColor,
    fontWeight: '500',
  },
});

export default ExternalContactSection;
