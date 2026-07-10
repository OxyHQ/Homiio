/**
 * SectionEyebrow — small, uppercase, wide-tracked label that sits above a
 * section title. Used to add the "Recommended for you" / "Near Barcelona"
 * narrative layer above the H1/H2 title without competing with it.
 *
 * Usage:
 *   <SectionEyebrow>{t('home.recommended.eyebrow')}</SectionEyebrow>
 *   <H1>{t('home.recommended.title')}</H1>
 */
import React from 'react';

import { Text as BloomText } from '@oxyhq/bloom/typography';

interface SectionEyebrowProps {
  children: React.ReactNode;
  className?: string;
}

export const SectionEyebrow: React.FC<SectionEyebrowProps> = ({ children, className }) => (
  <BloomText
    className={
      className ??
      'mb-1.5 text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground'
    }
  >
    {children}
  </BloomText>
);

export default SectionEyebrow;
