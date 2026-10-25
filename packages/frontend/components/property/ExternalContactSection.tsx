/**
 * Direct contact row for external aggregator listings when portal AJAX
 * captured phone / email / WhatsApp on ingest.
 */
import type React from 'react';
import { useCallback } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { RiExternalLinkLine } from '@oxy.so/bloom/icons/RiExternalLinkLine';
import { RiMailLine } from '@oxy.so/bloom/icons/RiMailLine';
import { RiPhoneLine } from '@oxy.so/bloom/icons/RiPhoneLine';
import { Item } from '@oxy.so/bloom/item';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { RiWhatsappLine } from '@/components/icons/RiWhatsappLine';
import { SECTION_GUTTER } from '@/components/property/Section';
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

function buildContactLinks(contact: NonNullable<Property['externalContact']>): ContactLink[] {
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
 * Leading glyph per channel. WhatsApp uses the app-local Remix
 * `RiWhatsappLine`: Bloom's set carries no WhatsApp mark, and a generic chat
 * bubble would hide which app the link opens.
 */
function ContactIcon({ kind }: { kind: ContactLink['key'] }) {
  const { colors } = useTheme();
  const fill = colors.primarySubtleForeground;
  if (kind === 'phone') {
    return <RiPhoneLine width={LINK_ICON_SIZE} height={LINK_ICON_SIZE} fill={fill} />;
  }
  if (kind === 'email') {
    return <RiMailLine width={LINK_ICON_SIZE} height={LINK_ICON_SIZE} fill={fill} />;
  }
  return <RiWhatsappLine width={LINK_ICON_SIZE} height={LINK_ICON_SIZE} fill={fill} />;
}

function ContactLinkRow({ link }: { link: ContactLink }) {
  const { colors } = useTheme();
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
      titleStyle={[styles.linkText, { color: colors.primarySubtleForeground }]}
      leading={<ContactIcon kind={link.key} />}
      trailing={
        <RiExternalLinkLine
          width={TRAILING_ICON_SIZE}
          height={TRAILING_ICON_SIZE}
          fill={colors.textSecondary}
        />
      }
      onPress={open}
      accessibilityRole="link"
      accessibilityLabel={link.label}
      style={{ backgroundColor: colors.backgroundTertiary }}
    />
  );
}

export const ExternalContactSection: React.FC<Props> = ({ property }) => {
  const { t } = useTranslation();
  if (!property?.isExternal || !property.externalContact) return null;

  const links = buildContactLinks(property.externalContact);
  if (links.length === 0) return null;

  const displayName =
    property.externalContact.agencyName?.trim() || property.externalContact.name?.trim();

  return (
    <View style={styles.container}>
      <BloomText style={styles.title}>{t('property.external.contactTitle')}</BloomText>
      {displayName ? (
        <BloomText className="text-muted-foreground" style={styles.subtitle}>
          {displayName}
        </BloomText>
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
  },
  subtitle: {
    fontSize: 14,
  },
  links: {
    gap: spacing.xs,
  },
  linkText: {
    fontWeight: '500',
  },
});
