import React from 'react';
import { useTranslation } from 'react-i18next';

import { RiCalendarLine, RiTimeLine } from '@oxy.so/bloom/icons';

import { Section, SectionRow } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { formatDate } from '@homiio/shared-types';
import { useFormatting } from '@/utils/format';
import type { Property } from '@homiio/shared-types';

interface Props { property: Property | null }

const ICON_SIZE = 20;

export const AvailabilitySection: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const { locale } = useFormatting();
    const availableFrom = property?.availableFrom || property?.createdAt;
    const leaseTerm = property?.leaseTerm;
    if (!availableFrom && !leaseTerm) return null;
    // A move-in date is a CIVIL date: it is the same day everywhere, so it is
    // rendered zone-independently (see `formatDate`) rather than being pushed
    // through `new Date()`, which reads a bare `YYYY-MM-DD` as UTC midnight and
    // shows the day before to every reader west of Greenwich.
    const dateStr = availableFrom ? formatDate(availableFrom, locale, 'UTC') : undefined;
    return (
        <Section title={t('property.sections.availability')}>
            {dateStr ? (
                <SectionRow
                    leading={<RiCalendarLine width={ICON_SIZE} height={ICON_SIZE} fill={colors.COLOR_BLACK_LIGHT_3} />}
                    label={t('property.sections.availableFrom')}
                    value={dateStr}
                />
            ) : null}
            {leaseTerm ? (
                <SectionRow
                    leading={<RiTimeLine width={ICON_SIZE} height={ICON_SIZE} fill={colors.COLOR_BLACK_LIGHT_3} />}
                    label={t('property.sections.leaseTerm')}
                    value={leaseTerm}
                />
            ) : null}
        </Section>
    );
};

export default AvailabilitySection;
