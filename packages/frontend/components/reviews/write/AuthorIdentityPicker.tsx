/**
 * AuthorIdentityPicker — how the author wants this review PUBLISHED.
 *
 * ADR 0003 §5.2 makes this the author's choice, and choosing needs the
 * consequence stated rather than the option named: "pseudonymous" means nothing
 * on its own, while "people can see that the same person wrote two reviews about
 * this building, and cannot follow you to another one" is a decision somebody
 * can actually make. So each option carries one line of what it does.
 *
 * Not `EnumChipSelector`: the dimension chips are optional and CLEARABLE, and
 * this is neither — a review is published in exactly one of the three forms, and
 * a tap that cleared the choice would leave a required field empty on the last
 * step of a long wizard. Pressable rows with `radio` semantics say that to a
 * screen reader too.
 *
 * `verified_anonymous_resident` is offered and is not the default. §5.2 offers
 * it by default for a review that criticises a landlord — but its published text
 * is *"Verified resident"*, and §6.1/F7 record that nothing writes
 * `reviews.verified`, so today it would be a claim nobody checked. Homiio
 * renders it as *"a resident"* until #364 builds verification, and the copy here
 * promises exactly that and no more.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Label } from '@oxy.so/bloom/label';
import { RiCheckboxBlankCircleLine, RiCheckboxCircleFill } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { ReviewAuthorIdentity } from '@homiio/shared-types';
import { spacing, radius } from '@/constants/styles';

/** In the order they disclose least to most, so the safest choice reads first. */
const FORMS: readonly ReviewAuthorIdentity[] = [
  ReviewAuthorIdentity.VERIFIED_ANONYMOUS_RESIDENT,
  ReviewAuthorIdentity.PSEUDONYMOUS,
  ReviewAuthorIdentity.IDENTIFIED,
];

const ICON_SIZE = 20;

export interface AuthorIdentityPickerProps {
  value: ReviewAuthorIdentity;
  onChange: (next: ReviewAuthorIdentity) => void;
}

export const AuthorIdentityPicker: React.FC<AuthorIdentityPickerProps> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={styles.block}>
      <Label required>{t('reviews.write.fields.authorIdentity')}</Label>
      <BloomText style={[styles.hint, { color: theme.colors.textSecondary }]}>
        {t('reviews.write.authorIdentity.hint')}
      </BloomText>
      <View style={styles.options}>
        {FORMS.map((form) => {
          const selected = form === value;
          const Icon = selected ? RiCheckboxCircleFill : RiCheckboxBlankCircleLine;
          return (
            <Pressable
              key={form}
              onPress={() => onChange(form)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={t(`reviews.write.authorIdentity.${form}.title`)}
              style={[
                styles.option,
                {
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                  backgroundColor: selected ? theme.colors.backgroundSecondary : 'transparent',
                },
              ]}
            >
              <Icon
                width={ICON_SIZE}
                height={ICON_SIZE}
                fill={selected ? theme.colors.primary : theme.colors.textTertiary}
              />
              <View style={styles.optionText}>
                <BloomText style={[styles.optionTitle, { color: theme.colors.text }]}>
                  {t(`reviews.write.authorIdentity.${form}.title`)}
                </BloomText>
                <BloomText style={[styles.optionBody, { color: theme.colors.textSecondary }]}>
                  {t(`reviews.write.authorIdentity.${form}.description`)}
                </BloomText>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  block: {
    gap: spacing.sm,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  optionBody: {
    fontSize: 13,
    lineHeight: 18,
  },
});

export default AuthorIdentityPicker;
