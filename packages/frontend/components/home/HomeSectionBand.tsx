/**
 * One finite, explainable band of the Home surface (#353).
 *
 * ## Every band states WHY it exists and WHERE its data came from
 *
 * The issue's acceptance criterion is "las secciones tienen razón y fuente
 * explícitas", and the reason it matters is the "personalización ética" section
 * beside it: a band a person cannot account for is an opaque ranking, whatever
 * its heading says. So both are rendered, always, from fields the SERVER sent —
 * `section.reason` names the rule, `section.source` names the data.
 *
 * They are not optional props with defaults. A band that could omit its reason
 * would eventually omit it, and the missing sentence is exactly what nobody
 * notices.
 *
 * ## It cannot render an empty band
 *
 * `HomeSectionsResponse` never contains a section with no items — a rule that
 * matched nothing produces no section at all — so there is no empty state here
 * and no `emptyText`. That is the structural half of "no mostrar secciones
 * vacías con contenido inventado": a heading with nothing under it is not
 * something this component can be asked to draw.
 */

import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { Text as BloomText } from '@oxyhq/bloom/typography';
import type { HomeSection, Property } from '@homiio/shared-types';

import { HomeCarouselSection } from '@/components/HomeCarouselSection';
import { PropertyCard } from '@/components/PropertyCard';
import { PAGE_GUTTER_CLASS } from '@/constants/styles';

export interface HomeSectionBandProps {
  section: HomeSection<Property>;
  /** Opens the section as a full search. Absent when it has no `nextAction`. */
  onSeeAll?: () => void;
}

export function HomeSectionBand({ section, onSeeAll }: HomeSectionBandProps): React.ReactElement {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <View className="gap-1">
      <HomeCarouselSection<Property>
        eyebrow={t(`home.sections.${section.id}.eyebrow`)}
        title={t(`home.sections.${section.id}.title`)}
        items={[...section.items]}
        loading={false}
        viewAllText={t('home.viewAll')}
        {...(onSeeAll ? { onViewAll: onSeeAll } : {})}
        renderItem={(property) => (
          <PropertyCard
            property={property}
            variant="featured"
            enableImageCarousel={false}
            onPress={() => router.push(`/properties/${property.id}`)}
          />
        )}
      />
      <View className={PAGE_GUTTER_CLASS}>
        <BloomText
          className="text-xs text-muted-foreground"
          // One announcement, so a screen reader does not read the rule and the
          // source as two unrelated fragments after the heading.
          accessibilityLabel={t('home.sections.explainAccessible', {
            reason: t(section.reason),
            source: t(`home.sections.source.${section.source}`),
          })}
        >
          {t('home.sections.explain', {
            reason: t(section.reason),
            source: t(`home.sections.source.${section.source}`),
          })}
        </BloomText>
      </View>
    </View>
  );
}
