/**
 * PropertyOverview — small key/value summary of bedrooms, bathrooms,
 * size, and (when present) floor.
 *
 * Each fact is a `SectionRow` (a Bloom `Item`) separated by a Bloom
 * `Divider`, the same row pattern as the availability and house-rules
 * sections so the detail page keeps one visual rhythm.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatArea } from '@homiio/shared-types';
import { useFormatting } from '@/utils/format';

import { Divider } from '@oxy.so/bloom/divider';

import { Section, SectionRow } from '@/components/property/Section';

interface OverviewProperty {
  bedrooms?: number;
  bathrooms?: number;
  size?: number;
  squareFootage?: number;
  floor?: number;
}

interface Props {
  property: OverviewProperty | null | undefined;
}

interface Row {
  label: string;
  value: string;
}

export const PropertyOverview: React.FC<Props> = ({ property }) => {
  const { t } = useTranslation();
  const { locale, areaUnitLabels } = useFormatting();
  const size = property?.size ?? property?.squareFootage;

  const rows: Row[] = [
    {
      label: t('property.sections.bedrooms'),
      value: property?.bedrooms !== undefined ? String(property.bedrooms) : '-',
    },
    {
      label: t('property.sections.bathrooms'),
      value: property?.bathrooms !== undefined ? String(property.bathrooms) : '-',
    },
    {
      label: t('property.sections.size'),
      value:
        size !== undefined
          ? formatArea(size, 'sqm', locale, { labels: areaUnitLabels })
          : '-',
    },
    ...(property?.floor !== undefined
      ? [
          {
            label: t('property.sections.floor'),
            value: String(property.floor),
          },
        ]
      : []),
  ];

  return (
    <Section title={t('property.sections.overview')}>
      {rows.map((row, idx) => (
        <React.Fragment key={row.label}>
          <SectionRow label={row.label} value={row.value} />
          {idx !== rows.length - 1 ? <Divider /> : null}
        </React.Fragment>
      ))}
    </Section>
  );
};

export default PropertyOverview;
