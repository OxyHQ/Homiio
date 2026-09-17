import React from 'react';
import { useTranslation } from 'react-i18next';

import { Chip } from '@oxy.so/bloom/chip';

import { Section, SectionRow } from '@/components/property/Section';
import type { Property } from '@homiio/shared-types';

interface Props { property: Property | null }

type RuleKey = 'petsAllowed' | 'smokingAllowed' | 'partiesAllowed';

/** Rendered in this order; a rule the listing leaves undefined is omitted. */
const RULES: readonly RuleKey[] = ['petsAllowed', 'smokingAllowed', 'partiesAllowed'];

export const HouseRules: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const rules = property?.rules;
    const present = RULES.filter((key) => rules?.[key] !== undefined);
    if (present.length === 0) return null;
    return (
        <Section title={t('propertyCreate.amenities.houseRules')}>
            {present.map((key) => {
                const allowed = rules?.[key] === true;
                return (
                    <SectionRow
                        key={key}
                        label={t(`propertyCreate.amenities.${key}`)}
                        value={
                            <Chip size="large" color={allowed ? 'success' : 'default'}>
                                {allowed ? t('propertyCreate.amenities.yes') : t('propertyCreate.amenities.no')}
                            </Chip>
                        }
                    />
                );
            })}
        </Section>
    );
};

export default HouseRules;
